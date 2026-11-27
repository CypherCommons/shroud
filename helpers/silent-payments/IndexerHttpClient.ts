import { fetch } from '../../util/fetch';
import { socks5Fetch } from '../../modules/socks5Fetch';
import TorManager, { DEFAULT_SOCKS_HOST } from '../../modules/torManager';

const RETRY_ATTEMPTS = 3;

type AttemptResult<T> = { ok: true; data: T } | { ok: false; retryable: boolean; answered: boolean; message: string };

// Runs `attempt` up to `attempts` times, backing off exponentially (capped at 8s) between
// retryable failures. Shared by the Tor and clearnet paths so both retry the same way on a
// retryable failure (thrown error, 5xx) vs. a definitive one (4xx), instead of drifting apart.
async function retryWithBackoff<T>(
  attempts: number,
  attempt: (attemptNumber: number) => Promise<AttemptResult<T>>,
  onAttemptFailed?: (attemptNumber: number, message: string) => void,
): Promise<AttemptResult<T>> {
  let lastResult: AttemptResult<T> = { ok: false, retryable: true, answered: false, message: 'no attempts made' };
  for (let attemptNumber = 1; attemptNumber <= attempts; attemptNumber++) {
    const result = await attempt(attemptNumber);
    if (result.ok) return result;

    lastResult = result;
    onAttemptFailed?.(attemptNumber, result.message);
    if (!result.retryable) break;
    if (attemptNumber < attempts) {
      const delay = Math.min(1000 * Math.pow(2, attemptNumber - 1), 8000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return lastResult;
}

export type RequestOptions = { timeout?: number; retries?: number };

export class IndexerHttpClient {
  private onionUrl?: string;

  constructor(
    private baseUrl: string,
    private timeout: number = 30000,
    onionUrl?: string,
  ) {
    this.onionUrl = onionUrl?.replace(/\/$/, '');
  }

  private async classifyResponse<T>(
    responsePromise: Promise<{ ok: boolean; status: number; json: () => Promise<any> }>,
  ): Promise<AttemptResult<T>> {
    let response;
    try {
      response = await responsePromise;
    } catch (error) {
      return { ok: false, retryable: true, answered: false, message: error instanceof Error ? error.message : String(error) };
    }

    if (!response.ok) {
      // 4xx is a definitive client-side rejection (bad request, not found, etc.) - retrying the
      // same request won't produce a different outcome, so don't burn the remaining attempts on it.
      // 429 is the exception: the indexer's rate limit, which the backoff is there to wait out.
      const retryable = response.status < 400 || response.status >= 500 || response.status === 429;
      return { ok: false, retryable, answered: true, message: `HTTP error! status: ${response.status}` };
    }

    try {
      return { ok: true, data: (await response.json()) as T };
    } catch (parseError) {
      return { ok: false, retryable: true, answered: true, message: parseError instanceof Error ? parseError.message : String(parseError) };
    }
  }

  private attemptTorFetch<T>(
    endpoint: string,
    connectTimeout: number,
    requestTimeout: number,
    socksPort: number,
  ): Promise<AttemptResult<T>> {
    return this.classifyResponse<T>(
      socks5Fetch(`${this.onionUrl}${endpoint}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        timeout: requestTimeout,
        connectTimeout,
        socksHost: DEFAULT_SOCKS_HOST,
        socksPort,
      }),
    );
  }

  private attemptClearnetFetch<T>(endpoint: string, timeout: number): Promise<AttemptResult<T>> {
    return this.classifyResponse<T>(
      fetch(`${this.baseUrl}${endpoint}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        timeout,
      }),
    );
  }

  private async executeGet<T>(endpoint: string, errorContext: string, options: RequestOptions = {}): Promise<T> {
    const timeout = options.timeout ?? this.timeout;
    const attempts = options.retries ?? RETRY_ATTEMPTS;

    const torManager = TorManager.getInstance();
    await torManager.ensureLoaded();

    // 'checking' is included so a request that fires just after Tor is enabled attempts the
    // connection instead of failing immediately while the initial socket test is still in flight.
    if (torManager.settings.enabled && this.onionUrl && (torManager.isReady || torManager.status === 'checking')) {
      // `timeout` is a total budget for the caller's request, not a per-attempt one - split it
      // across the retries so a hung Orbot/onion service can't turn one request into `attempts`
      // times the configured timeout before falling back to clearnet. Each attempt's own budget is
      // further split between connect and request phases, since socks5Fetch times those separately
      // and sequentially - otherwise every attempt would silently carry an extra connect timeout on
      // top of the request timeout.
      const perAttemptTimeout = Math.max(1, Math.floor(timeout / attempts));
      const perAttemptConnectTimeout = Math.max(1, Math.floor(perAttemptTimeout / 3));
      const perAttemptRequestTimeout = Math.max(1, perAttemptTimeout - perAttemptConnectTimeout);

      const torResult = await retryWithBackoff<T>(
        attempts,
        () => this.attemptTorFetch<T>(endpoint, perAttemptConnectTimeout, perAttemptRequestTimeout, torManager.socksPort),
        (attemptNumber, message) => console.warn(`[IndexerHttpClient] Tor attempt ${attemptNumber}/${attempts} failed: ${message}`),
      );

      if (torResult.ok) return torResult.data;

      if (!torResult.retryable) {
        // A non-retryable failure (e.g. 4xx) means the onion service answered - Tor itself is
        // working, so don't mark it unavailable, and don't bother re-issuing the same request
        // over clearnet against what's presumably the same backend.
        throw new Error(`${errorContext}: ${torResult.message}`);
      }

      if (!torResult.answered) {
        torManager.markUnavailable();
      }
    }

    if (torManager.isTorOnly) {
      throw new Error(
        this.onionUrl
          ? `${errorContext}: Tor-only mode is enabled but Tor is unavailable. Ensure Orbot is running.`
          : `${errorContext}: Tor-only mode is enabled but no .onion URL is configured.`,
      );
    }

    if (torManager.settings.enabled && this.onionUrl) {
      console.warn('[IndexerHttpClient] Tor unavailable, falling back to clearnet');
    }

    const clearnetResult = await retryWithBackoff<T>(attempts, () => this.attemptClearnetFetch<T>(endpoint, timeout));
    if (clearnetResult.ok) return clearnetResult.data;

    throw new Error(`${errorContext}: ${clearnetResult.message}`);
  }

  async get<T>(endpoint: string, errorContext: string, options: RequestOptions = {}): Promise<T> {
    return this.executeGet<T>(endpoint, errorContext, options);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '');
  }
}
