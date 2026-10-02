declare module '@env' {
  /** Deprecated alias for INDEXER_BASE_URL_MAINNET, kept so existing .env files keep working. */
  export const INDEXER_BASE_URL: string;
  export const INDEXER_BASE_URL_MAINNET: string;
  export const INDEXER_BASE_URL_TESTNET4: string;
  export const INDEXER_BASE_URL_SIGNET: string;
  /** Mainnet's .onion indexer address; keeps its original name. */
  export const INDEXER_ONION_URL: string;
  export const INDEXER_ONION_URL_TESTNET4: string;
  export const INDEXER_ONION_URL_SIGNET: string;
}
