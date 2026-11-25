import loc from '../loc';
import { IconProps } from '../components/icons/types';
import ChevronDownIcon from '../components/icons/ChevronDownIcon';
import CopyIcon from '../components/icons/CopyIcon';
import InfoIcon from '../components/icons/InfoIcon';

const keys = {
  CopyTXID: 'copyTX_ID',
  ExpandNote: 'expandNote',
  CopyAmount: 'copyAmount',
  CopyNote: 'copyNote',
  ChoosePhoto: 'choose_photo',
  ImportFile: 'import_file',
  SendMax: 'send_max',
  CoinControl: 'coin_control',
  SortASC: 'sortASC',
  SortDESC: 'sortDESC',
  SortHeight: 'sortHeight',
  SortValue: 'sortValue',
  SortLabel: 'sortLabel',
  SortStatus: 'sortStatus',
  Details: 'details',
} as const;

// Only the actions with a fitting icon of ours get one.
const icons = {
  Copy: CopyIcon,
  Details: InfoIcon,
  Expand: ChevronDownIcon,
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

export const CommonToolTipActions = {
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
  CopyNote: {
    id: keys.CopyNote,
    text: loc.transactions.details_copy_note,
    icon: icons.Copy,
  },
  ChoosePhoto: {
    id: keys.ChoosePhoto,
    text: loc.wallets.list_long_choose,
  },
  ImportFile: {
    id: keys.ImportFile,
    text: loc.wallets.import_file,
  },
  SendMax: {
    id: keys.SendMax,
    text: loc.send.details_adv_full,
    hidden: true,
  },
  CoinControl: {
    id: keys.CoinControl,
    text: loc.cc.header,
    hidden: false,
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
  Details: {
    id: keys.Details,
    text: loc.send.create_details,
    icon: icons.Details,
  },
} as const satisfies Record<string, ToolTipAction>;
