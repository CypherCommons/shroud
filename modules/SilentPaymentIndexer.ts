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
  SpentIndexBlock,
  SpentIndexResponse,
} from '../helpers/silent-payments/types';

// Small metadata lookups a user is actively waiting on. The configured timeout is sized for bulk
// range queries; inheriting it here makes create/import/track hang for minutes on a dead indexer.
const FAST_LOOKUP = { timeout: 8000, retries: 1 };

export const RANGE_BATCH_SIZE = 50;

/**
 * Invoked once per scanned range, empty or not, so the caller can track progress. `spentBlocks` is
 * null when the spent index could not be fetched (e.g. an indexer without it), so the caller knows
 * that range was not checked for spends.
 */
export type RangeProcessedCallback = (
  transactions: IndexerTransaction[],
  rangeEnd: number,
  spentBlocks: SpentIndexBlock[] | null,
) => Promise<number>;

export class SilentPaymentIndexer {
  private httpClient: IndexerHttpClient;

  constructor(config: SilentPaymentIndexerConfig) {
    const baseUrl = config.baseUrl.replace(/\/$/, '');
    this.httpClient = new IndexerHttpClient(baseUrl, config.timeout, config.onionUrl);
  }

  getBaseUrl(): string {
    return this.httpClient.getBaseUrl();
  }

  setBaseUrl(url: string): void {
    this.httpClient.setBaseUrl(url);
  }

  async getHealth(): Promise<HealthResponse> {
    return this.httpClient.get<HealthResponse>('/health', 'Error fetching indexer health', FAST_LOOKUP);
  }

  async getTransactionsByHeight(height: number): Promise<TransactionResponse> {
    return this.httpClient.get<TransactionResponse>(`/transactions/height/${height}`, `Error fetching transactions by height ${height}`);
  }

  async getTransactionsByRange(startHeight: number, endHeight: number): Promise<TransactionResponse> {
    return this.httpClient.get<TransactionResponse>(
      `/transactions/range?startHeight=${startHeight}&endHeight=${endHeight}`,
      `Error fetching transactions by range ${startHeight}-${endHeight}`,
    );
  }

  async getSpentIndexByRange(startHeight: number, endHeight: number): Promise<SpentIndexResponse> {
    return this.httpClient.get<SpentIndexResponse>(
      `/silent-block/spent-index/range?startHeight=${startHeight}&endHeight=${endHeight}`,
      `Error fetching spent index by range ${startHeight}-${endHeight}`,
    );
  }

  async getLatestBlockHeight(): Promise<LatestBlockHeightResponse> {
    return this.httpClient.get<LatestBlockHeightResponse>('/silent-block/latest-height', 'Error fetching latest block height', FAST_LOOKUP);
  }

  async getBlockHeightByTimestamp(timestamp: number): Promise<BlockHeightByTimestampResponse> {
    return this.httpClient.get<BlockHeightByTimestampResponse>(
      `/transactions/timestamp-to-height?timestamp=${timestamp}`,
      `Error fetching block height for timestamp ${timestamp}`,
      FAST_LOOKUP,
    );
  }

  async getTransactionByTxid(txid: string): Promise<TransactionByTxidResponse> {
    return this.httpClient.get<TransactionByTxidResponse>(
      `/transactions/txid/${txid}`,
      `Error fetching transaction by txid ${txid}`,
      FAST_LOOKUP,
    );
  }

  /**
   * Scan forward using range queries for better performance.
   * Uses the range API to fetch up to 50 blocks at a time.
   *
   * @param {number} startHeight - Starting block height
   * @param {number} endHeight - Ending block height
   * @param {Function} processTransactions - Callback to process transactions from each range
   * @param {ScanProgressCallback} onProgress - Optional progress callback
   */
  async scanForwardWithCallback(
    startHeight: number,
    endHeight: number,
    processTransactions: RangeProcessedCallback,
    onProgress?: ScanProgressCallback,
    cancelCallback?: () => boolean,
  ): Promise<void> {
    await this.scanBlocks(startHeight, endHeight, processTransactions, onProgress, cancelCallback);
  }

  private async scanBlocks(
    startHeight: number,
    endHeight: number,
    onRangeProcessed?: RangeProcessedCallback,
    onProgress?: ScanProgressCallback,
    cancelCallback?: () => boolean,
  ): Promise<void> {
    const totalBlocks = endHeight - startHeight + 1;
    let blocksScanned = 0;
    let utxosFound = 0;

    for (let rangeStart = startHeight; rangeStart <= endHeight; rangeStart += RANGE_BATCH_SIZE) {
      if (cancelCallback?.()) {
        throw new Error('SCAN_CANCELLED');
      }

      const rangeEnd = Math.min(rangeStart + RANGE_BATCH_SIZE - 1, endHeight);
      const rangeSize = rangeEnd - rangeStart + 1;

      let response: TransactionResponse;
      try {
        response = await this.getTransactionsByRange(rangeStart, rangeEnd);
      } catch (error: any) {
        // abort instead of logging, or else this will flood the log with errors when indexer is down.
        // only the fetch is wrapped: a bug in the caller's callbacks must not masquerade as a fetch failure.
        throw new Error(`Failed to fetch range ${rangeStart}-${rangeEnd}: ${error?.message ?? error}`);
      }

      // after the transactions, not alongside them, so a range costs one request at a time against
      // the indexer's rate limit. a failure here only skips spend detection for the range: receiving
      // must keep working against an indexer that has no spent index yet
      let spentBlocks: SpentIndexBlock[] | null = null;
      try {
        spentBlocks = (await this.getSpentIndexByRange(rangeStart, rangeEnd)).blocks;
      } catch (error: any) {
        console.warn(`[SP] No spent index for range ${rangeStart}-${rangeEnd}: ${error?.message ?? error}`);
      }

      // called for empty ranges too, so the caller can advance its scan watermark past them
      if (onRangeProcessed) {
        utxosFound += await onRangeProcessed(response.transactions, rangeEnd, spentBlocks);
      }

      blocksScanned += rangeSize;

      if (onProgress) {
        await onProgress({
          currentBlock: rangeEnd,
          tipHeight: endHeight,
          totalBlocks,
          blocksScanned,
          percentComplete: (blocksScanned / totalBlocks) * 100,
          utxosFound,
        });
      }
    }
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
