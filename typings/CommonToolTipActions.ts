import loc from '../loc';
import { IconProps } from '../components/icons/types';
import ChevronDownIcon from '../components/icons/ChevronDownIcon';
import CopyIcon from '../components/icons/CopyIcon';
import DownloadIcon from '../components/icons/DownloadIcon';
import InfoIcon from '../components/icons/InfoIcon';
import ShareIcon from '../components/icons/ShareIcon';

const keys = {
  CopyTXID: 'copyTX_ID',
  ExpandNote: 'expandNote',
  CopyAmount: 'copyAmount',
  CopyNote: 'copyNote',
  ImportWallet: 'importWallet',
  HideBalance: 'hideBalance',
  ViewInBitcoin: 'viewInBitcoin',
  ViewInSats: 'viewInSats',
  ViewInFiat: 'viewInFiat',
  SearchAccount: 'searchAccount',
  Passphrase: 'passphrase',
  MoreInfo: 'moreInfo',
  SaveChanges: 'saveChanges',
  ClearClipboard: 'clearClipboard',
  ScanQR: 'scan_qr',
  RemoveAllRecipients: 'RemoveAllRecipients',
  AddRecipient: 'AddRecipient',
  RemoveRecipient: 'RemoveRecipient',
  ChoosePhoto: 'choose_photo',
  ImportFile: 'import_file',
  SignPSBT: 'sign_psbt',
  SendMax: 'send_max',
  AllowRBF: 'allow_rbf',
  ImportTransaction: 'import_transaction',
  ImportTransactionQR: 'import_transaction_qr',
  CoinControl: 'coin_control',
  CopyToClipboard: 'copyToClipboard',
  Share: 'share',
  SaveFile: 'saveFile',
  PasteFromClipboard: 'pasteFromClipboard',
  Hide: 'hide',
  SortASC: 'sortASC',
  SortDESC: 'sortDESC',
  SortHeight: 'sortHeight',
  SortValue: 'sortValue',
  SortLabel: 'sortLabel',
  SortStatus: 'sortStatus',
  Delete: 'delete',
  Details: 'details',
} as const;

// Only the actions with a fitting icon of ours get one.
const icons = {
  Copy: CopyIcon,
  Details: InfoIcon,
  Expand: ChevronDownIcon,
  Share: ShareIcon,
  Save: DownloadIcon,
};

export type ToolTipAction = {
  id: string;
  text: string;
  subtitle?: string;
  icon?: React.ComponentType<IconProps>;
  hidden?: boolean;
  menuState?: boolean;
  destructive?: boolean;
};

export const CommonToolTipActions: Record<string, ToolTipAction> = {
  CopyTXID: {
    id: keys.CopyTXID,
    text: loc.transactions.details_copy_txid,
    icon: icons.Copy,
  },
  ExpandNote: {
    id: keys.ExpandNote,
    text: loc.transactions.expand_note,
    icon: icons.Expand,
  },
  CopyAmount: {
    id: keys.CopyAmount,
    text: loc.transactions.details_copy,
    icon: icons.Copy,
  },
  AddRecipient: {
    id: keys.AddRecipient,
    text: loc.send.details_add_rec_add,
  },
  RemoveRecipient: {
    id: keys.RemoveRecipient,
    text: loc.send.details_add_rec_rem,
  },
  CopyNote: {
    id: keys.CopyNote,
    text: loc.transactions.details_copy_note,
    icon: icons.Copy,
  },
  ImportWallet: {
    id: keys.ImportWallet,
    text: loc.wallets.add_import_wallet,
  },
  HideBalance: {
    id: keys.HideBalance,
    text: loc.transactions.details_balance_hide,
  },
  Hide: {
    id: keys.Hide,
    text: loc.total_balance_view.hide,
  },
  ViewInFiat: {
    id: keys.ViewInFiat,
    text: loc.total_balance_view.display_in_fiat,
    hidden: false,
  },
  ViewInSats: {
    id: keys.ViewInSats,
    text: loc.total_balance_view.display_in_sats,
    hidden: false,
  },
  ViewInBitcoin: {
    id: keys.ViewInBitcoin,
    text: loc.total_balance_view.display_in_bitcoin,
    hidden: false,
  },
  RemoveAllRecipients: {
    id: keys.RemoveAllRecipients,
    text: loc.send.details_add_rec_rem_all,
  },
  SearchAccount: {
    id: keys.SearchAccount,
    text: loc.wallets.import_search_accounts,
    menuState: false,
  },
  Passphrase: {
    id: keys.Passphrase,
    text: loc.wallets.import_passphrase,
    menuState: false,
  },
  MoreInfo: {
    id: keys.MoreInfo,
    text: loc.wallets.more_info,
    hidden: false,
  },
  SaveChanges: {
    id: keys.SaveChanges,
    text: loc._.save,
  },
  ScanQR: {
    id: keys.ScanQR,
    text: loc.wallets.list_long_scan,
  },
  ChoosePhoto: {
    id: keys.ChoosePhoto,
    text: loc.wallets.list_long_choose,
  },
  ImportFile: {
    id: keys.ImportFile,
    text: loc.wallets.import_file,
  },
  SignPSBT: {
    id: keys.SignPSBT,
    text: loc.send.psbt_sign,
    hidden: true,
  },
  SendMax: {
    id: keys.SendMax,
    text: loc.send.details_adv_full,
    hidden: true,
  },
  AllowRBF: {
    id: keys.AllowRBF,
    text: loc.send.details_adv_fee_bump,
    hidden: true,
    menuState: false,
  },
  ImportTransaction: {
    id: keys.ImportTransaction,
    text: loc.send.details_adv_import,
    hidden: true,
  },
  ImportTransactionQR: {
    id: keys.ImportTransactionQR,
    text: loc.send.details_adv_import_qr,
    hidden: true,
  },
  CoinControl: {
    id: keys.CoinControl,
    text: loc.cc.header,
    hidden: false,
  },
  CopyToClipboard: {
    id: keys.CopyToClipboard,
    text: loc.transactions.details_copy,
    icon: icons.Copy,
  },
  Share: {
    id: keys.Share,
    text: loc.receive.details_share,
    icon: icons.Share,
  },
  PasteFromClipboard: {
    id: keys.PasteFromClipboard,
    text: loc.wallets.paste_from_clipboard,
  },
  ClearClipboard: {
    id: keys.ClearClipboard,
    text: loc.wallets.clear_clipboard_on_import,
    menuState: true,
  },
  SortASC: {
    id: keys.SortASC,
    text: loc.cc.sort_asc,
  },
  SortDESC: {
    id: keys.SortDESC,
    text: loc.cc.sort_desc,
  },
  SortHeight: {
    id: keys.SortHeight,
    text: loc.cc.sort_height,
  },
  SortValue: {
    id: keys.SortValue,
    text: loc.cc.sort_value,
  },
  SortLabel: {
    id: keys.SortLabel,
    text: loc.cc.sort_label,
  },
  SortStatus: {
    id: keys.SortStatus,
    text: loc.cc.sort_status,
  },
  SaveFile: {
    id: keys.SaveFile,
    text: loc._.save,
    icon: icons.Save,
  },
  Delete: {
    id: keys.Delete,
    text: loc.wallets.details_delete,
    destructive: true,
  },
  Details: {
    id: keys.Details,
    text: loc.send.create_details,
    icon: icons.Details,
  },
} as const;
