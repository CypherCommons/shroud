import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import { View, ViewStyle, StyleSheet, Text } from 'react-native';
import { Transaction } from '../class/wallets/types';
import loc, { formatBalanceWithoutSuffix, transactionTimeToReadable } from '../loc';
import { BitcoinUnit } from '../models/bitcoinUnits';
import ListItem from './ListItem';
import { useTheme } from './themes';
import { Action, ToolTipMenuProps } from './types';
import { useExtendedNavigation } from '../hooks/useExtendedNavigation';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DetailViewStackParamList } from '../navigation/DetailViewStackParamList';
import { useStorage } from '../hooks/context/useStorage';
import ToolTipMenu from './TooltipMenu';
import { CommonToolTipActions } from '../typings/CommonToolTipActions';
import { pop } from '../NavigationService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HighlightedText from './HighlightedText';
import { shortenAddress, getRelevantAddress, isIncomingTransaction } from '../utils/transactionHelpers';
import TransactionDirectionIcon from './icons/TransactionDirectionIcon';
import { getTransactionIconColors } from './icons/getTransactionIconColors';
import { ClashFont } from '../constants/fonts';

const ROW_TYPOGRAPHY = {
  fontSize: 14.6,
  lineHeight: 18,
  letterSpacing: -0.1,
  fontFamily: ClashFont.medium,
} as const;

const styles = StyleSheet.create({
  subtitle: {
    fontSize: 13,
    fontFamily: ClashFont.regular,
  },
  subtitleTime: {
    fontSize: 12,
    opacity: 0.6,
  },
  title: {
    ...ROW_TYPOGRAPHY,
  },
  rightTitleContainer: {
    alignSelf: 'flex-start',
  },
  subtitleGap: {
    marginTop: 8,
  },
  highlight: {
    backgroundColor: '#FFF5C0',
    color: '#000000',
    fontSize: 13,
    fontWeight: '600',
  },
});

interface TransactionListItemProps {
  itemPriceUnit?: BitcoinUnit;
  walletID: string;
  item: Transaction;
  searchQuery?: string;
  style?: ViewStyle;
  renderHighlightedText?: (text: string, query: string) => React.JSX.Element;
  onPress?: () => void;
}

type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList>;

export const TransactionListItem: React.FC<TransactionListItemProps> = memo(
  ({
    item,
    itemPriceUnit = BitcoinUnit.BTC,
    walletID,
    searchQuery,
    style,
    renderHighlightedText,
    onPress: customOnPress,
  }: TransactionListItemProps) => {
    const [subtitleNumberOfLines, setSubtitleNumberOfLines] = useState(1);
    const { colors } = useTheme();
    const stylesHook = StyleSheet.create({
      subtitle: {
        color: colors.foregroundColor,
      },
    });
    const { navigate } = useExtendedNavigation<NavigationProps>();
    const menuRef = useRef<ToolTipMenuProps | null>(null);
    const { txMetadata } = useStorage();
    const insets = useSafeAreaInsets();
    const containerStyle = useMemo(
      () => ({
        backgroundColor: colors.cardBackground,
        borderColor: colors.transactionCardBorder,
        borderWidth: 0.5,
        borderRadius: 16,
        minHeight: 77,
        marginHorizontal: 16,
        marginBottom: 12,
        paddingHorizontal: 16,
        paddingVertical: 8,
      }),
      [colors.cardBackground, colors.transactionCardBorder],
    );

    const combinedStyle = useMemo(() => [containerStyle, style], [containerStyle, style]);

    const relevantAddress = getRelevantAddress(item);

    const isIncoming = isIncomingTransaction(item.value);

    const leftAvatar = useMemo(
      () => <TransactionDirectionIcon size={44} {...getTransactionIconColors(colors, item.value)} />,
      [item.value, colors],
    );

    const title = useMemo(() => {
      if (relevantAddress) {
        return shortenAddress(relevantAddress);
      }
      if (item.confirmations === 0) {
        return loc.transactions.pending;
      } else {
        return transactionTimeToReadable(item.timestamp);
      }
    }, [relevantAddress, item.confirmations, item.timestamp]);

    const timeText = useMemo(() => {
      if (item.confirmations === 0) {
        return loc.transactions.pending;
      } else {
        const now = new Date();
        const txDate = new Date(item.timestamp * 1000);
        const timeDifferenceMs = now.getTime() - txDate.getTime();
        const hoursDifference = timeDifferenceMs / (1000 * 60 * 60);

        if (hoursDifference > 24) {
          return txDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
        } else {
          // Show relative time for recent transactions
          return transactionTimeToReadable(item.timestamp);
        }
      }
    }, [item.confirmations, item.timestamp]);

    const txMemo = txMetadata[item.hash]?.memo ?? '';
    const subtitle = useMemo(() => {
      let sub =
        Number(item.confirmations) < 7
          ? loc.formatString(loc.transactions.list_conf, {
              number: item.confirmations,
            })
          : timeText;
      if (sub !== '') sub += ' ';
      sub += txMemo;
      return sub || undefined;
    }, [timeText, txMemo, item.confirmations]);

    const formattedAmount = useMemo(() => {
      const formatted = formatBalanceWithoutSuffix(item.value && item.value, itemPriceUnit, true).toString();
      return isIncoming ? `+${formatted}` : formatted;
    }, [item.value, itemPriceUnit, isIncoming]);

    const rowTitle = useMemo(() => {
      return formattedAmount;
    }, [formattedAmount]);

    const rowTitleStyle = useMemo(() => {
      const color = isIncoming ? colors.brandPrimary : colors.foregroundColor;

      return {
        ...ROW_TYPOGRAPHY,
        color,
        textAlign: 'right' as const,
        paddingRight: insets.right,
        paddingLeft: insets.left,
      };
    }, [isIncoming, colors.brandPrimary, colors.foregroundColor, insets.right, insets.left]);

    useEffect(() => {
      setSubtitleNumberOfLines(1);
    }, [subtitle]);

    const onPress = useCallback(async () => {
      menuRef?.current?.dismissMenu?.();
      // If a custom onPress handler was provided, use it and return
      if (customOnPress) {
        customOnPress();
        return;
      }

      if (item.hash) {
        if (renderHighlightedText) {
          pop();
        }
        navigate('TransactionDetails', { tx: item, hash: item.hash, walletID });
      }
    }, [item, renderHighlightedText, navigate, walletID, customOnPress]);

    const handleOnExpandNote = useCallback(() => {
      setSubtitleNumberOfLines(0);
    }, []);

    const handleOnDetailsPress = useCallback(() => {
      if (walletID && item && item.hash) {
        navigate('TransactionDetails', { tx: item, hash: item.hash, walletID });
      }
    }, [item, navigate, walletID]);

    const handleOnCopyAmountTap = useCallback(() => Clipboard.setString(rowTitle.replace(/[\s+\\-]/g, '')), [rowTitle]);
    const handleOnCopyTransactionID = useCallback(() => Clipboard.setString(item.hash), [item.hash]);
    const handleOnCopyNote = useCallback(() => Clipboard.setString(subtitle ?? ''), [subtitle]);

    const onToolTipPress = useCallback(
      (id: any) => {
        if (id === CommonToolTipActions.CopyAmount.id) {
          handleOnCopyAmountTap();
        } else if (id === CommonToolTipActions.CopyNote.id) {
          handleOnCopyNote();
        } else if (id === CommonToolTipActions.ExpandNote.id) {
          handleOnExpandNote();
        } else if (id === CommonToolTipActions.CopyTXID.id) {
          handleOnCopyTransactionID();
        } else if (id === CommonToolTipActions.Details.id) {
          handleOnDetailsPress();
        }
      },
      [handleOnCopyAmountTap, handleOnCopyNote, handleOnCopyTransactionID, handleOnDetailsPress, handleOnExpandNote],
    );
    const toolTipActions = useMemo((): Action[] => {
      const actions: (Action | Action[])[] = [
        {
          ...CommonToolTipActions.CopyAmount,
        },
        {
          ...CommonToolTipActions.CopyNote,
          hidden: !subtitle,
        },
        {
          ...CommonToolTipActions.CopyTXID,
          hidden: !item.hash,
        },
        CommonToolTipActions.Details,
        [
          {
            ...CommonToolTipActions.ExpandNote,
            hidden: subtitleNumberOfLines !== 1,
          },
        ],
      ];

      return actions as Action[];
    }, [subtitle, item.hash, subtitleNumberOfLines]);

    const accessibilityState = useMemo(() => {
      return {
        expanded: subtitleNumberOfLines === 0,
      };
    }, [subtitleNumberOfLines]);

    const subtitleProps = useMemo(() => ({ numberOfLines: subtitleNumberOfLines }), [subtitleNumberOfLines]);

    return (
      <ToolTipMenu
        isButton
        actions={toolTipActions}
        onPressMenuItem={onToolTipPress}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
      >
        <ListItem
          title={title}
          titleStyle={styles.title}
          subtitleStyle={styles.subtitleGap}
          subtitleNumberOfLines={subtitleNumberOfLines}
          subtitle={
            subtitle ? (
              renderHighlightedText ? (
                renderHighlightedText(subtitle, searchQuery ?? '')
              ) : relevantAddress ? (
                <Text style={[styles.subtitle, stylesHook.subtitle, styles.subtitleTime]}>{subtitle}</Text>
              ) : (
                <HighlightedText
                  text={subtitle}
                  query={searchQuery ?? ''}
                  caseSensitive={false}
                  highlightOnlyFirstMatch={searchQuery ? searchQuery.length === 1 : false}
                  style={[styles.subtitle, stylesHook.subtitle]}
                />
              )
            ) : undefined
          }
          Component={View}
          subtitleProps={subtitleProps}
          chevron={false}
          leftAvatar={leftAvatar}
          bottomDivider={false}
          rightTitle={rowTitle}
          rightTitleStyle={rowTitleStyle}
          rightTitleContainerStyle={styles.rightTitleContainer}
          containerStyle={combinedStyle}
          testID="TransactionListItem"
        />
      </ToolTipMenu>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.item.hash === nextProps.item.hash &&
      prevProps.item.timestamp === nextProps.item.timestamp &&
      prevProps.itemPriceUnit === nextProps.itemPriceUnit &&
      prevProps.walletID === nextProps.walletID &&
      prevProps.searchQuery === nextProps.searchQuery
    );
  },
);
