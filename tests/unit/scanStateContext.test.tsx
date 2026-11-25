import React, { useContext } from 'react';
import { act } from '@testing-library/react-native';

import { ShroudApp } from '../../class';
import { StorageContext } from '../../components/Context/StorageProvider';
import type { ScanProgress, ScanStateInfo } from '../../helpers/silent-payments/types';
import { useScanState, useScanStatus } from '../../hooks/context/useScanState';
import { renderStorageWithWallet } from '../helpers/storageProvider';

const progressAt = (percentComplete: number): ScanProgress => ({
  currentBlock: 900_000,
  tipHeight: 900_100,
  totalBlocks: 100,
  blocksScanned: percentComplete,
  percentComplete,
  utxosFound: 0,
});

describe('unit - scan state contexts', () => {
  const renders = { storage: 0, scanState: 0, scanStatus: 0 };
  let scanState: ScanStateInfo;

  // stand-ins for the screens under the provider: what each reads, and how often it renders
  const StorageReader = () => {
    renders.storage++;
    useContext(StorageContext);
    return null;
  };
  const ScanStateReader = () => {
    renders.scanState++;
    scanState = useScanState();
    return null;
  };
  const ScanStatusReader = () => {
    renders.scanStatus++;
    useScanStatus();
    return null;
  };

  afterEach(() => {
    ShroudApp.getInstance().wallets = [];
  });

  it('re-renders only the scan’s readers on a progress report, and status readers only when the status changes', () => {
    const { wallet } = renderStorageWithWallet(
      <>
        <StorageReader />
        <ScanStateReader />
        <ScanStatusReader />
      </>,
    );
    const before = { ...renders };

    act(() => (wallet as any)._emitScanState('scanning', { progress: progressAt(10) }));
    act(() => (wallet as any)._emitScanState('scanning', { progress: progressAt(20) }));

    expect(renders.storage).toBe(before.storage);
    expect(renders.scanState).toBe(before.scanState + 2);
    expect(renders.scanStatus).toBe(before.scanStatus + 1);
    expect(scanState.progress?.percentComplete).toBe(20);
  });
});
