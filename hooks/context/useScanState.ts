import { useContext } from 'react';
import { ScanStateContext, ScanStatusContext } from '../../components/Context/StorageProvider';

/** The scan's whole state. Re-renders on every progress report while a scan runs. */
export const useScanState = () => useContext(ScanStateContext);

/** Only the scan's status, for readers that don't need its progress. */
export const useScanStatus = () => useContext(ScanStatusContext);
