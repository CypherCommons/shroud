import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityActionEvent, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomModal, { BottomModalHandle } from './BottomModal';
import { CheckboxBox } from './Checkbox';
import SettingsCard from './SettingsCard';
import SettingsRowWrapper from './SettingsRowWrapper';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';
import { ToolTipMenuProps, Action } from './types';

const LONG_PRESS_ACTIONS = [{ name: 'longpress' }];

// A run of loose actions shares a card; an array of actions gets a card of its own.
const toGroups = (actions: Action[] | Action[][]): Action[][] => {
  const groups: Action[][] = [];
  let loose: Action[] | null = null;
  for (const entry of actions) {
    if (Array.isArray(entry)) {
      groups.push(entry);
      loose = null;
    } else {
      if (!loose) groups.push((loose = []));
      loose.push(entry);
    }
  }
  return groups.map(group => group.filter(action => !action.hidden)).filter(group => group.length > 0);
};

// Opens its actions in a bottom sheet: on tap when the menu is the primary action, otherwise on long press.
const ToolTipMenu = (props: ToolTipMenuProps) => {
  const {
    title,
    actions,
    isMenuPrimaryAction = false,
    isButton = false,
    disabled = false,
    onPress,
    buttonStyle,
    onPressMenuItem,
    onMenuWillShow,
    onMenuWillHide,
    children,
    ...restProps
  } = props;
  const { colors } = useTheme();
  const sheetRef = useRef<BottomModalHandle>(null);
  // The sheet is mounted only while open, as a list can hold a menu on every row.
  const [isOpen, setIsOpen] = useState(false);
  const groups = useMemo(() => toGroups(actions), [actions]);
  const opensOnLongPress = !isMenuPrimaryAction;

  useEffect(() => {
    if (isOpen) sheetRef.current?.present();
  }, [isOpen]);

  const open = useCallback(() => {
    onMenuWillShow?.();
    setIsOpen(true);
  }, [onMenuWillShow]);

  const onClose = useCallback(() => {
    setIsOpen(false);
    onMenuWillHide?.();
  }, [onMenuWillHide]);

  // The sheet goes first, so an action that presents something of its own (a picker, the share sheet) isn't blocked by it.
  const select = async (id: Action['id']) => {
    await sheetRef.current?.dismiss();
    onPressMenuItem(id.toString());
  };

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'longpress') open();
    },
    [open],
  );

  const renderRow = (action: Action) => {
    const { icon: Icon, menuState } = action;
    const color = action.destructive ? colors.statusError : colors.textPrimary;
    return (
      <Pressable
        accessibilityRole={menuState === undefined ? 'button' : 'checkbox'}
        accessibilityState={{ checked: menuState, disabled: action.disabled }}
        accessibilityLabel={action.subtitle ? `${action.text}, ${action.subtitle}` : action.text}
        disabled={action.disabled}
        onPress={() => select(action.id)}
        style={({ pressed }) => [
          styles.row,
          action.disabled && styles.rowDisabled,
          pressed && Platform.OS !== 'android' && styles.rowPressed,
        ]}
        android_ripple={{ color: colors.borderDefault }}
        testID={`ToolTipMenuItem-${action.id}`}
      >
        {Icon && <Icon size={20} color={color} />}
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color }]}>{action.text}</Text>
          {action.subtitle ? <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>{action.subtitle}</Text> : null}
        </View>
        {menuState !== undefined && <CheckboxBox value={menuState} />}
      </Pressable>
    );
  };

  if (actions.length === 0) return null;

  return (
    <>
      <TouchableOpacity
        style={buttonStyle}
        disabled={disabled}
        // Content that isn't a button, like a QR code, stays still under the finger.
        activeOpacity={isButton ? undefined : 1}
        onPress={opensOnLongPress ? onPress : open}
        onLongPress={opensOnLongPress ? open : undefined}
        accessibilityActions={opensOnLongPress ? LONG_PRESS_ACTIONS : undefined}
        onAccessibilityAction={opensOnLongPress ? onAccessibilityAction : undefined}
        {...restProps}
      >
        {children}
      </TouchableOpacity>
      {isOpen && (
        <BottomModal
          ref={sheetRef}
          detents={['auto']}
          // Rounds the top corners only; the native sheet squares off the bottom two.
          cornerRadius={16}
          backgroundColor={colors.background}
          showCloseButton={false}
          contentStyle={styles.sheet}
          onClose={onClose}
        >
          <View style={styles.container} testID="ToolTipMenuSheet">
            {title ? <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text> : null}
            {groups.map((group, groupIndex) => (
              <SettingsCard key={groupIndex}>
                {group.map((action, index) => (
                  <SettingsRowWrapper key={action.id} showSeparator={index < group.length - 1}>
                    {renderRow(action)}
                  </SettingsRowWrapper>
                ))}
              </SettingsCard>
            ))}
          </View>
        </BottomModal>
      )}
    </>
  );
};

export default ToolTipMenu;

const styles = StyleSheet.create({
  sheet: { paddingTop: 0, paddingHorizontal: 0 },
  // The top padding clears the native grabber.
  container: { paddingTop: 28, paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  title: { fontFamily: ClashFont.medium, fontSize: 17, lineHeight: 26, textAlign: 'center', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  rowPressed: { opacity: 0.7 },
  rowDisabled: { opacity: 0.35 },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: ClashFont.medium, fontSize: 16 },
  rowSubtitle: { fontFamily: ClashFont.regular, fontSize: 13, marginTop: 2 },
});
