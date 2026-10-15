import { Buffer } from 'buffer';
import DefaultPreference from 'react-native-default-preference';
import TcpSocket from 'react-native-tcp-socket';
import { Linking, Platform } from 'react-native';
import Share from 'react-native-share';
import { openLink } from '../helpers/openLink';
import { GROUP_IO_SHROUD } from './currency';

const TOR_ENABLED_KEY = 'tor_enabled';
const TOR_ONLY_KEY = 'tor_only';
const TOR_SOCKS_PORT_KEY = 'tor_socks_port';
export const DEFAULT_SOCKS_HOST = '127.0.0.1';
const DEFAULT_SOCKS_PORT = 9050;
const ORBOT_PACKAGE = 'org.torproject.android';
// Orbot for iOS registers the orbot: scheme - the same URL Guardian Project's OrbotKit probes.
const ORBOT_IOS_URL = 'orbot:show';

export type TorStatus = 'disabled' | 'checking' | 'connected' | 'unavailable';

export interface TorSettings {
  enabled: boolean;
  socksPort: number;
  /** When true, requests fail if Tor is unavailable instead of falling back to clearnet */
  torOnly: boolean;
}

const DEFAULT_SETTINGS: TorSettings = {
  enabled: false,
  socksPort: DEFAULT_SOCKS_PORT,
  torOnly: false,
};

const UNAVAILABLE_RETRY_MS = 30000;

class TorManager {
  private static instance: TorManager;
  private _status: TorStatus = 'disabled';
  private _settings: TorSettings = { ...DEFAULT_SETTINGS };
  private _listeners: Set<(status: TorStatus) => void> = new Set();
  private _loadPromise: Promise<TorSettings> | null = null;
  private _checkGeneration = 0;
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;

  static getInstance(): TorManager {
    if (!TorManager.instance) {
      TorManager.instance = new TorManager();
    }
    return TorManager.instance;
  }

  get status(): TorStatus {
    return this._status;
  }

  get settings(): TorSettings {
    return { ...this._settings };
  }

  get socksPort(): number {
    return this._settings.socksPort;
  }

  get isReady(): boolean {
    return this._status === 'connected';
  }

  /** When true, clearnet fallback is blocked — requests must go through Tor or fail */
  get isTorOnly(): boolean {
    return this._settings.enabled && this._settings.torOnly;
  }

  async loadSettings(): Promise<TorSettings> {
    try {
      await DefaultPreference.setName(GROUP_IO_SHROUD);
      const enabledValue = await DefaultPreference.get(TOR_ENABLED_KEY);
      const torOnlyValue = await DefaultPreference.get(TOR_ONLY_KEY);
      const portValue = await DefaultPreference.get(TOR_SOCKS_PORT_KEY);

      const enabled = enabledValue === 'true';
      const port = portValue ? Number(portValue) : DEFAULT_SETTINGS.socksPort;
      this._settings = {
        enabled,
        torOnly: enabled && torOnlyValue === 'true',
        socksPort: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_SETTINGS.socksPort,
      };
    } catch (e) {
      console.warn('[TorManager] Failed to load settings:', e);
    }

    if (this._settings.enabled) {
      // Kick off the probe without blocking callers on its latency (up to 5s) - loadSettings
      // only needs to report the persisted settings, not the live connection status.
      this.checkConnection();
    } else {
      this._setStatus('disabled');
    }

    return this._settings;
  }

  /** Loads settings on first call; subsequent calls await the same in-flight/completed load. */
  async ensureLoaded(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = this.loadSettings();
    }
    await this._loadPromise;
  }

  async saveSettings(settings: Partial<TorSettings>): Promise<void> {
    const next = { ...this._settings, ...settings };
    try {
      await DefaultPreference.setName(GROUP_IO_SHROUD);
      await DefaultPreference.set(TOR_ENABLED_KEY, next.enabled ? 'true' : 'false');
      await DefaultPreference.set(TOR_ONLY_KEY, next.torOnly ? 'true' : 'false');
      await DefaultPreference.set(TOR_SOCKS_PORT_KEY, String(next.socksPort));
      this._settings = next;
    } catch (e) {
      console.warn('[TorManager] Failed to save settings:', e);
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.saveSettings({ enabled });
      await this.checkConnection();
    } else {
      await this.saveSettings({ enabled, torOnly: false });
      this._checkGeneration++;
      this._clearRetryTimer();
      this._setStatus('disabled');
    }
  }

  async setTorOnly(torOnly: boolean): Promise<void> {
    await this.saveSettings({ torOnly });
  }

  async setSocksPort(port: number): Promise<void> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid SOCKS5 port: ${port}. Must be an integer between 1 and 65535.`);
    }
    await this.saveSettings({ socksPort: port });
    if (this._settings.enabled) {
      await this.checkConnection();
    }
  }

  async checkConnection(): Promise<boolean> {
    this._clearRetryTimer();

    if (!this._settings.enabled) {
      this._checkGeneration++;
      this._setStatus('disabled');
      return false;
    }

    const generation = ++this._checkGeneration;
    this._setStatus('checking');

    try {
      const available = await this._testSocksProxy();
      if (generation === this._checkGeneration) {
        this._setStatus(available ? 'connected' : 'unavailable');
        if (!available) this._scheduleRetry();
      }
      return available;
    } catch {
      if (generation === this._checkGeneration) {
        this._setStatus('unavailable');
        this._scheduleRetry();
      }
      return false;
    }
  }

  markUnavailable(): void {
    if (this._status === 'connected') {
      this._setStatus('unavailable');
    }
    this._scheduleRetry();
  }

  private _scheduleRetry(): void {
    if (this._retryTimer || !this._settings.enabled) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (this._settings.enabled && this._status === 'unavailable') {
        this.checkConnection();
      }
    }, UNAVAILABLE_RETRY_MS);
  }

  private _clearRetryTimer(): void {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  /**
   * The OS only reveals Orbot to apps that declare it: the <queries> package in
   * AndroidManifest.xml, and the orbot scheme under LSApplicationQueriesSchemes in Info.plist.
   */
  static async isOrbotInstalled(): Promise<boolean> {
    try {
      if (Platform.OS === 'ios') {
        return await Linking.canOpenURL(ORBOT_IOS_URL);
      }
      const { isInstalled } = await Share.isPackageInstalled(ORBOT_PACKAGE);
      return isInstalled;
    } catch {
      return false;
    }
  }

  static openOrbotInstallPage(): void {
    const url =
      Platform.OS === 'android'
        ? 'https://guardianproject.info/releases/orbot-latest.apk'
        : 'https://apps.apple.com/app/orbot/id1609461599';
    openLink(url);
  }

  private _testSocksProxy(): Promise<boolean> {
    return new Promise(resolve => {
      let resolved = false;
      let pending: Buffer = Buffer.alloc(0);

      const finalize = (result: boolean) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        try {
          client.destroy();
        } catch {}
        resolve(result);
      };

      const timeout = setTimeout(() => finalize(false), 5000);

      const client = TcpSocket.createConnection({ host: DEFAULT_SOCKS_HOST, port: this._settings.socksPort }, () => {
        // Send SOCKS5 greeting: version 5, 1 method, no-auth
        const greeting = Buffer.from([0x05, 0x01, 0x00]);
        client.write(greeting);
      });

      client.on('data', (data: string | Buffer) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        pending = pending.length ? Buffer.from(Buffer.concat([pending, buf])) : buf;
        // Valid SOCKS5 response: version 5, no auth method selected
        if (pending.length >= 2) {
          finalize(pending[0] === 0x05 && pending[1] === 0x00);
        }
      });

      client.on('error', () => finalize(false));
      client.on('close', () => finalize(false));
    });
  }

  private _setStatus(status: TorStatus): void {
    if (this._status !== status) {
      this._status = status;
      console.log(`[TorManager] Status: ${status}`);
      this._listeners.forEach(cb => cb(status));
    }
  }

  addStatusListener(listener: (status: TorStatus) => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }
}

export default TorManager;
