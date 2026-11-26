import React, { useContext } from 'react';
import { act, render } from '@testing-library/react-native';

import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { StorageContext, StorageProvider } from '../../components/Context/StorageProvider';

const TEST_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/**
 * A StorageProvider around `children`, holding a silent payments wallet added the way the app adds one.
 * `storage()` is the context it hands out as of now. Clear `ShroudApp.getInstance().wallets` after each test.
 */
export const renderStorageWithWallet = (children: React.ReactNode = null) => {
  const context: { current?: React.ContextType<typeof StorageContext> } = {};
  const StorageReader = () => {
    context.current = useContext(StorageContext);
    return null;
  };
  render(
    <StorageProvider>
      <StorageReader />
      {children}
    </StorageProvider>,
  );

  const wallet = new HDSilentPaymentsWallet();
  wallet.setSecret(TEST_SEED);
  act(() => {
    context.current!.addWallet(wallet);
  });
  return { wallet, storage: () => context.current! };
};
