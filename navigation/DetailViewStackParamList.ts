import { NavigatorScreenParams } from '@react-navigation/native';

import { Transaction } from '../class/wallets/types';
import { OwnedOutput } from '../class/wallets/hd-bip352-wallet';
import { ElectrumServerItem } from '../modules/Electrum';
import { SendDetailsStackParamList } from './SendDetailsStackParamList';
import { AddWalletStackParamList } from './AddWalletStack';

export type ScanQRCodeParamList = {
  cameraStatusGranted?: boolean;
  backdoorPressed?: boolean;
  launchedBy?: string;
  urTotal?: number;
  urHave?: number;
  backdoorText?: string;
  onBarScanned?: (data: string) => void;
  showFileImportButton?: boolean;
  backdoorVisible?: boolean;
  orientation?: 'portrait';
  animatedQRCodeData?: Record<string, any>;
};

export type DetailViewStackParamList = {
  DrawerRoot: undefined;
  UnlockWithScreen: undefined;
  WalletsList: { onBarScanned?: string };
  TransactionDetails: { tx: Transaction; hash: string; walletID: string };

  Broadcast: object;
  Success: undefined;
  AddWalletRoot?: {
    screen?: keyof AddWalletStackParamList;
    params?: AddWalletStackParamList[keyof AddWalletStackParamList];
  };
  // A nested navigator: params have to name their target screen, or they stop at the navigator
  // and the screen renders with its initialParams instead.
  SendDetailsRoot: NavigatorScreenParams<SendDetailsStackParamList>;
  WalletExportRoot: undefined;
  Settings: undefined;
  Currency: undefined;
  General: undefined;
  ThemeSettings: undefined;
  DenominationSettings: undefined;
  Contacts: undefined;
  ContactDetail: { address: string };
  // Discriminated: an 'edit' without an address would render an Edit form that silently inserts
  // a second contact, because upsertContact would see no editingAddress.
  ContactEdit: { mode: 'add'; address?: string } | { mode: 'edit'; address: string };
  Tools: undefined;
  Licensing: undefined;
  About: undefined;
  ElectrumServerSettings: { server?: ElectrumServerItem };
  BlockExplorerSettings: undefined;
  TorSettings: undefined;
  NetworkSettings: undefined;
  BitcoinNetworkSettings: undefined;
  Security: undefined;
  ChangePin: { remove?: boolean } | undefined;
  ViewRecoveryPhrase: undefined;
  PlausibleDeniability: undefined;
  ReceiveDetails: {
    walletID?: string;
    address: string;
  };
  ScanQRCode: ScanQRCodeParamList;
  Onboarding: undefined;
  TrackPayment: undefined;
  PaymentFound: { txid: string; outputs: OwnedOutput[]; totalValue: number; confirmations: number };
  NoPaymentFound: undefined;
  SyncScreen: undefined;
};
