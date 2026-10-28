import { AccessibilityRole, ViewStyle } from 'react-native';
import { IconProps } from './icons/types';

export interface Action {
  id: string | number;
  text: string;
  icon?: React.ComponentType<IconProps>;
  subtitle?: string;
  // Set, true or false, on each item of a pick-one list: its row shows a radio button.
  menuState?: boolean;
  destructive?: boolean;
  hidden?: boolean;
  disabled?: boolean;
}

export interface ToolTipMenuProps {
  actions: Action[] | Action[][];
  children: React.ReactNode;
  enableAndroidRipple?: boolean;
  dismissMenu?: () => void;
  onPressMenuItem: (id: string) => void;
  title?: string;
  isMenuPrimaryAction?: boolean;
  isButton?: boolean;
  renderPreview?: () => React.ReactNode;
  onPress?: () => void;
  previewValue?: string;
  accessibilityRole?: AccessibilityRole;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle | ViewStyle[];
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: object;
  buttonStyle?: ViewStyle | ViewStyle[];
  onMenuWillShow?: () => void;
  onMenuWillHide?: () => void;
}
