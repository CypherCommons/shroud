import React, { useCallback, useMemo } from 'react';
import { Platform, StyleProp, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { MenuView, MenuAction, NativeActionEvent } from '@react-native-menu/menu';
import { ToolTipMenuProps, Action } from './types';

const leaveLongPressToMenu = () => {};

const ToolTipMenu = (props: ToolTipMenuProps) => {
  const {
    title = '',
    isMenuPrimaryAction = false,
    disabled = false,
    onPress,
    buttonStyle,
    onPressMenuItem,
    children,
    isButton = false,
    ...restProps
  } = props;

  // Map Menu Items for RN Menu (supports subactions and displayInline)
  const mapMenuItemForMenuView = useCallback((action: Action): MenuAction | null => {
    if (!action.id) return null;

    // Check for subactions
    const subactions =
      action.subactions?.map(subaction => {
        const subMenuItem: MenuAction = {
          id: subaction.id.toString(),
          title: subaction.text,
          subtitle: subaction.subtitle,
          image: subaction.icon?.iconValue ? subaction.icon.iconValue : undefined,
          attributes: { disabled: subaction.disabled, destructive: subaction.destructive, hidden: subaction.hidden },
        };
        if ('menuState' in subaction) {
          subMenuItem.state = subaction.menuState ? 'on' : 'off';
        }
        if (subaction.subactions && subaction.subactions.length > 0) {
          const deepSubactions = subaction.subactions.map(deepSub => {
            const deepMenuItem: MenuAction = {
              id: deepSub.id.toString(),
              title: deepSub.text,
              subtitle: deepSub.subtitle,
              image: deepSub.icon?.iconValue ? deepSub.icon.iconValue : undefined,
              attributes: { disabled: deepSub.disabled, destructive: deepSub.destructive, hidden: deepSub.hidden },
            };
            if ('menuState' in deepSub) {
              deepMenuItem.state = deepSub.menuState ? 'on' : 'off';
            }
            return deepMenuItem;
          });
          subMenuItem.subactions = deepSubactions;
        }
        return subMenuItem;
      }) || [];

    const menuItem: MenuAction = {
      id: action.id.toString(),
      title: action.text,
      subtitle: action.subtitle,
      image: action.icon?.iconValue ? action.icon.iconValue : undefined,
      attributes: { disabled: action.disabled, destructive: action.destructive, hidden: action.hidden },
      displayInline: action.displayInline || false,
    };
    if ('menuState' in action) {
      menuItem.state = action.menuState ? 'on' : 'off';
    }
    if (subactions.length > 0) {
      menuItem.subactions = subactions;
    }
    return menuItem;
  }, []);

  const menuViewItemsIOS = useMemo(() => {
    return props.actions
      .map(actionGroup => {
        if (Array.isArray(actionGroup) && actionGroup.length > 0) {
          return {
            id: actionGroup[0].id.toString(),
            title: '',
            subactions: actionGroup
              .filter(action => action.id)
              .map(mapMenuItemForMenuView)
              .filter(item => item !== null) as MenuAction[],
            displayInline: true,
          };
        } else if (!Array.isArray(actionGroup) && actionGroup.id) {
          return mapMenuItemForMenuView(actionGroup);
        }
        return null;
      })
      .filter(item => item !== null) as MenuAction[];
  }, [props.actions, mapMenuItemForMenuView]);

  const menuViewItemsAndroid = useMemo(() => {
    const mergedActions = props.actions.flat().filter(action => action.id);
    return mergedActions.map(mapMenuItemForMenuView).filter(item => item !== null) as MenuAction[];
  }, [props.actions, mapMenuItemForMenuView]);

  const handlePressMenuItemForMenuView = useCallback(
    ({ nativeEvent }: NativeActionEvent) => {
      onPressMenuItem(nativeEvent.event);
    },
    [onPressMenuItem],
  );

  const renderMenuView = () => {
    const opensOnLongPress = !isMenuPrimaryAction;

    const renderMenu = (content: React.ReactNode, style?: StyleProp<ViewStyle>) => (
      <MenuView
        title={title}
        isAnchoredToRight
        onPressAction={handlePressMenuItemForMenuView}
        actions={Platform.OS === 'ios' ? menuViewItemsIOS : menuViewItemsAndroid}
        shouldOpenOnLongPress={opensOnLongPress}
        style={style}
        // @ts-ignore: Not exposed in types
        accessibilityLabel={props.accessibilityLabel}
        accessibilityHint={props.accessibilityHint}
        accessibilityRole={props.accessibilityRole}
        accessibilityLanguage="en"
      >
        {content}
      </MenuView>
    );

    if (!isButton && !isMenuPrimaryAction) return renderMenu(children);

    const renderTouchable = (content: React.ReactNode) => (
      <TouchableOpacity
        style={buttonStyle}
        disabled={disabled}
        onPress={onPress}
        // The long press belongs to the menu: claiming it stops the release from also firing onPress.
        onLongPress={opensOnLongPress ? leaveLongPressToMenu : undefined}
        {...restProps}
      >
        {content}
      </TouchableOpacity>
    );

    // On iOS, MenuView mounts its native button above its React children, so the button takes
    // every tap and a touchable nested inside the menu never sees one. There the menu goes inside
    // the touchable instead, laid over its content: the touchable is then an ancestor of whatever
    // is tapped, and the menu still gets the long press. Android keeps the menu outside, because a
    // touchable that owns a gesture takes it from the native views inside it, cancelling the long press.
    if (opensOnLongPress && Platform.OS === 'ios') {
      return renderTouchable(
        <>
          {children}
          {renderMenu(null, StyleSheet.absoluteFill)}
        </>,
      );
    }
    return renderMenu(renderTouchable(children));
  };

  return props.actions.length > 0 ? renderMenuView() : null;
};

export default ToolTipMenu;
