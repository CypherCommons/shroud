import type { RequestOptions } from '../helpers/silent-payments/IndexerHttpClient';
import { IndexerHttpClient } from '../helpers/silent-payments/IndexerHttpClient';
import type {
  HealthResponse,
  LatestBlockHeightResponse,
  BlockHeightByTimestampResponse,
  TransactionResponse,
  IndexerTransaction,
  SilentPaymentIndexerConfig,
  ScanProgressCallback,
  TransactionByTxidResponse,
} from '../helpers/silent-payments/types';

// Small metadata lookups a user is actively waiting on. The configured timeout is sized for bulk
// range queries; inheriting it here makes create/import/track hang for minutes on a dead indexer.
const FAST_LOOKUP = { timeout: 8000, retries: 1 };

// Mirrors the indexer's MAX_BLOCK_RANGE. Scan windows are aligned to multiples of it because the
// indexer stores 1000 blocks per partition and 1000 is a multiple of 50, so an aligned window never
// straddles a partition boundary (a straddling query has to read two partitions). This is only an
// optimisation: any window is still correct if the indexer uses a different partition width.
const RANGE_BATCH_SIZE = 50;

function isIndexerTransaction(tx: any): boolean {
  return (
    typeof tx?.id === 'string' &&
    Number.isSafeInteger(tx.blockHeight) &&
    tx.blockHeight >= 0 &&
    typeof tx.blockHash === 'string' &&
    Number.isFinite(tx.blockTime) &&
    typeof tx.scanTweak === 'string' &&
    Array.isArray(tx.outputs) &&
    tx.outputs.every(
      (output: any) =>
        typeof output?.transactionId === 'string' &&
        Number.isSafeInteger(output.vout) &&
        output.vout >= 0 &&
        typeof output.pubKey === 'string' &&
        Number.isSafeInteger(output.value) &&
        output.value >= 0 &&
        // Rust uses serde(default) for isSpent; deployed indexers omit it.
        (output.isSpent === undefined || [true, false, 0, 1].includes(output.isSpent)),
    )
  );
}

/** Invoked once per scanned range, empty or not, so the caller can track progress. */
export type RangeProcessedCallback = (transactions: IndexerTransaction[], rangeEnd: number) => Promise<number>;

class IndexerTipChangedError extends Error {
  constructor(readonly tipHeight: number) {
    super('The replacement indexer has not indexed the entire requested range yet.');
  }
}

type BlockRange = { start: number; end: number };

export class SilentPaymentIndexer {
  private httpClient!: IndexerHttpClient;
  private fallbackClient?: IndexerHttpClient;
  private usingFallback = false;
  private generation = 0;

  constructor(config: SilentPaymentIndexerConfig) {
    this.configure(config);
  }

  configure(config: SilentPaymentIndexerConfig): void {
    this.generation++;
    this.httpClient = new IndexerHttpClient(config.baseUrl.replace(/\/$/, ''), config.timeout, config.onionUrl);
    this.fallbackClient = config.fallback
      ? new IndexerHttpClient(config.fallback.baseUrl, config.fallback.timeout, config.fallback.onionUrl)
      : undefined;
    this.usingFallback = false;
  }

  isUsingFallback(): boolean {
    return this.usingFallback;
  }

  private activateFallback(primary: IndexerHttpClient, fallback: IndexerHttpClient): void {
    if (this.httpClient === primary) {
      this.httpClient = fallback;
      this.fallbackClient = undefined;
      this.usingFallback = true;
      this.generation++;
    }
  }

  private async request<T>(endpoint: string, context: string, options: RequestOptions = {}, range?: BlockRange): Promise<T> {
    const primary = this.httpClient;
    const fallback = this.fallbackClient;
    const read = async (client: IndexerHttpClient, requestOptions: RequestOptions): Promise<T> => {
      const result = await client.get<T>(endpoint, context, requestOptions);
      // Validate before advancing any scan watermark; a malformed success must trigger fallback.
      const data = result as any;
      const valid =
        endpoint === '/health'
          ? typeof data?.status === 'string'
          : endpoint.startsWith('/silent-block/')
            ? Number.isSafeInteger(data?.height) && data.height > 0
            : endpoint.startsWith('/transactions/timestamp-to-height')
              ? Number.isSafeInteger(data?.blockHeight) && data.blockHeight >= 0
              : endpoint.startsWith('/transactions/txid/')
                ? data && isIndexerTransaction(data.transaction)
                : Array.isArray(data?.transactions) && data.transactions.every(isIndexerTransaction);
      const inRange =
        valid &&
        (!range || data.transactions.every((tx: IndexerTransaction) => tx.blockHeight >= range.start && tx.blockHeight <= range.end));
      if (!valid || !inRange) throw new Error(`${context}: invalid indexer response`);
      return result;
    };
    try {
      const result = await read(primary, fallback ? { ...options, retries: 1, timeout: 8000 } : options);
      // A settings change or another request's fallback must not return stale backend data.
      if (this.httpClient !== primary) return this.request<T>(endpoint, context, options, range);
      return result;
    } catch (error) {
      if (this.httpClient !== primary) return this.request<T>(endpoint, context, options, range);
      if (!fallback) throw error;
      if (range) {
        // An empty response above the fallback's indexed tip is not proof that blocks were scanned.
        const tip = await fallback.get<LatestBlockHeightResponse>(
          '/silent-block/latest-height',
          'Error fetching fallback block height',
          FAST_LOOKUP,
        );
        if (!Number.isSafeInteger(tip?.height) || tip.height <= 0) throw new Error('Invalid fallback block height');
        if (this.httpClient !== primary) return this.request<T>(endpoint, context, options, range);
        this.activateFallback(primary, fallback);
        if (range.end > tip.height) throw new IndexerTipChangedError(tip.height);
      }
      const result = await read(fallback, options);
      // Keep using the default until restart or an explicit retry/save, avoiding a timeout per batch.
      this.activateFallback(primary, fallback);
      if (this.httpClient !== fallback) return this.request<T>(endpoint, context, options, range);
      return result;
    }
  }

  getBaseUrl(): string {
    return this.httpClient.getBaseUrl();
  }

  setBaseUrl(url: string): void {
    this.httpClient.setBaseUrl(url);
  }

  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health', 'Error fetching indexer health', FAST_LOOKUP);
  }

  async getTransactionsByHeight(height: number): Promise<TransactionResponse> {
    return this.request<TransactionResponse>(
      `/transactions/height/${height}`,
      `Error fetching transactions by height ${height}`,
      {},
      { start: height, end: height },
    );
  }

  async getTransactionsByRange(startHeight: number, endHeight: number): Promise<TransactionResponse> {
    return this.request<TransactionResponse>(
      `/transactions/range?startHeight=${startHeight}&endHeight=${endHeight}`,
      `Error fetching transactions by range ${startHeight}-${endHeight}`,
      {},
      { start: startHeight, end: endHeight },
    );
  }

  async getLatestBlockHeight(): Promise<LatestBlockHeightResponse> {
    return this.request<LatestBlockHeightResponse>('/silent-block/latest-height', 'Error fetching latest block height', FAST_LOOKUP);
  }

  async getBlockHeightByTimestamp(timestamp: number): Promise<BlockHeightByTimestampResponse> {
    return this.request<BlockHeightByTimestampResponse>(
      `/transactions/timestamp-to-height?timestamp=${timestamp}`,
      `Error fetching block height for timestamp ${timestamp}`,
      FAST_LOOKUP,
    );
  }

  async getTransactionByTxid(txid: string): Promise<TransactionByTxidResponse> {
    return this.request<TransactionByTxidResponse>(`/transactions/txid/${txid}`, `Error fetching transaction by txid ${txid}`, FAST_LOOKUP);
  }

  /**
   * Scan forward using range queries for better performance.
   * Uses the range API to fetch up to 50 blocks at a time.
   *
   * @param {number} startHeight - Starting block height
   * @param {number} endHeight - Ending block height
   * @param {Function} processTransactions - Callback to process transactions from each range
   * @param {ScanProgressCallback} onProgress - Optional progress callback
   * @returns The final indexed tip, which may shrink if a replacement backend is behind.
   */
  async scanForwardWithCallback(
    startHeight: number,
    endHeight: number,
    processTransactions: RangeProcessedCallback,
    onProgress?: ScanProgressCallback,
    cancelCallback?: () => boolean,
  ): Promise<number> {
    return this.scanBlocks(startHeight, endHeight, processTransactions, onProgress, cancelCallback);
  }

  private async scanBlocks(
    startHeight: number,
    endHeight: number,
    onRangeProcessed?: RangeProcessedCallback,
    onProgress?: ScanProgressCallback,
    cancelCallback?: () => boolean,
  ): Promise<number> {
    // The settings may have changed since the caller fetched its tip. Anchor the scan to
    // the backend that will actually serve its batches, then re-anchor after every replacement.
    endHeight = Math.min(endHeight, (await this.getLatestBlockHeight()).height);
    let scanGeneration = this.generation;
    let blocksScanned = 0;
    let utxosFound = 0;

    let rangeStart = startHeight;
    while (rangeStart <= endHeight) {
      if (cancelCallback?.()) {
        throw new Error('SCAN_CANCELLED');
      }

      if (scanGeneration !== this.generation) {
        endHeight = Math.min(endHeight, (await this.getLatestBlockHeight()).height);
        scanGeneration = this.generation;
        continue;
      }

      // End on the last height of this window's RANGE_BATCH_SIZE bucket, so only the first window can be short.
      const rangeEnd = Math.min(rangeStart - (rangeStart % RANGE_BATCH_SIZE) + RANGE_BATCH_SIZE - 1, endHeight);
      const rangeSize = rangeEnd - rangeStart + 1;

      let response: TransactionResponse;
      try {
        response = await this.getTransactionsByRange(rangeStart, rangeEnd);
      } catch (error: any) {
        if (error instanceof IndexerTipChangedError) {
          endHeight = Math.min(endHeight, error.tipHeight);
          // Keep the old generation so the next iteration also confirms the current backend.
          continue;
        }
        // abort instead of logging, or else this will flood the log with errors when indexer is down.
        // only the fetch is wrapped: a bug in the caller's callbacks must not masquerade as a fetch failure.
        throw new Error(`Failed to fetch range ${rangeStart}-${rangeEnd}: ${error?.message ?? error}`);
      }

      // Failover or settings can change while the request is in flight. Recompute the range
      // against the replacement tip before committing any data or scan progress.
      if (scanGeneration !== this.generation) continue;

      // called for empty ranges too, so the caller can advance its scan watermark past them
      if (onRangeProcessed) {
        utxosFound += await onRangeProcessed(response.transactions, rangeEnd);
      }

      blocksScanned += rangeSize;

      if (onProgress) {
        const totalBlocks = endHeight - startHeight + 1;
        await onProgress({
          currentBlock: rangeEnd,
          tipHeight: endHeight,
          totalBlocks,
          blocksScanned,
          percentComplete: (blocksScanned / totalBlocks) * 100,
          utxosFound,
        });
      }

      rangeStart = rangeEnd + 1;
    }
    return endHeight;
  }
}

let defaultIndexer: SilentPaymentIndexer | null = null;

export function initializeIndexer(config: SilentPaymentIndexerConfig): void {
  defaultIndexer = new SilentPaymentIndexer(config);
}

export function getDefaultIndexer(): SilentPaymentIndexer {
  if (!defaultIndexer) {
    throw new Error('Silent Payment Indexer not initialized. Call initializeIndexer() first.');
  }
  return defaultIndexer;
}

export function disconnectIndexer(): void {
  defaultIndexer = null;
}
