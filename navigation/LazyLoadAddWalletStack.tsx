import React, { lazy, Suspense } from 'react';

import { LazyLoadingIndicator } from './LazyLoadingIndicator';

// Define lazy imports with more reliable loading patterns
const ImportWallet = lazy(() => import('../screen/wallets/ImportWallet'));
const PleaseBackup = lazy(() => import('../screen/wallets/PleaseBackup'));

export const ImportWalletComponent = () => (
  <Suspense fallback={<LazyLoadingIndicator />}>
    <ImportWallet />
  </Suspense>
);

export const PleaseBackupComponent = () => (
  <Suspense fallback={<LazyLoadingIndicator />}>
    <PleaseBackup />
  </Suspense>
);
