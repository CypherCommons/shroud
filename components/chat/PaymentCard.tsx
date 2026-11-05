import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import type { ThreadItem } from '../../helpers/chat/ChatService';
import { ClashFont } from '../../constants/fonts';
import loc, { formatBalance } from '../../loc';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import ActionButton from '../ActionButton';
import CheckmarkIcon from '../icons/CheckmarkIcon';
import ClockIcon from '../icons/ClockIcon';
import PaperPlaneIcon from '../icons/PaperPlaneIcon';
import { useTheme } from '../themes';
import { formatMessageTime } from './ChatBubble';

type NoticeItem = Extract<ThreadItem, { kind: 'notice' }>;
type RequestItem = Extract<ThreadItem, { kind: 'request' }>;

const sats = (amount: number) => formatBalance(amount, BitcoinUnit.SATS, true);

/** Fades its child in whenever `stateKey` changes. Native-driver: LayoutAnimation is unreliable on Fabric. */
const FadeIn: React.FC<{ stateKey: string; children: React.ReactNode }> = ({ stateKey, children }) => {
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [stateKey, opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
};

const noticeLabel = (item: NoticeItem, name: string): string => {
  if (item.mine) {
    if (item.status === 'confirmed') return loc.chat.card_confirmed;
    if (item.status === 'received') return loc.formatString(loc.chat.card_received_by, { name }) as string;
    return loc.chat.card_sent;
  }
  switch (item.status) {
    case 'confirmed':
      return loc.chat.card_confirmed;
    case 'pending':
      return loc.chat.card_pending;
    case 'waiting':
      return loc.chat.card_waiting;
    default:
      return loc.chat.card_verifying;
  }
};

interface NoticeCardProps {
  item: NoticeItem;
  /** The other party's name, for "Received by Bob". */
  name: string;
}

/** A payment in the thread: what moved, and where it is on its way to confirmed. */
export const PaymentNoticeCard: React.FC<NoticeCardProps> = ({ item, name }) => {
  const { colors } = useTheme();
  const confirmed = item.status === 'confirmed';
  const label = noticeLabel(item, name);
  // Incoming amounts are what our own scan matched. Until it has matched, the sender's claim is shown
  // muted as a claim, never as something received.
  const matched = item.mine || item.amount !== undefined;
  const amount = item.mine ? item.notice.amount : (item.amount ?? item.notice.amount);
  const tint = confirmed
    ? colors.statusSuccess
    : item.status === 'verifying' || item.status === 'sent'
      ? colors.textMuted
      : colors.brandPrimary;
  const StatusIcon = confirmed ? CheckmarkIcon : ClockIcon;

  return (
    <View style={[styles.row, item.mine ? styles.rowMine : styles.rowTheirs]}>
      <View
        testID={`ChatNotice-${item.id}`}
        style={[styles.card, { backgroundColor: colors.surfaceBrandSubtle, borderColor: colors.borderDefault }]}
      >
        <View style={styles.head}>
          <PaperPlaneIcon size={16} color={colors.textBrand} />
          <Text style={[styles.title, { color: colors.textBrand }]}>{item.mine ? loc.chat.card_you_sent : loc.chat.card_you_received}</Text>
        </View>
        <Text style={[styles.amount, { color: matched ? colors.textPrimary : colors.textMuted }]}>{sats(amount)}</Text>
        {!!item.notice.note && <Text style={[styles.note, { color: colors.textSecondary }]}>{item.notice.note}</Text>}
        <FadeIn stateKey={item.status}>
          <View style={styles.status} testID={`ChatNoticeStatus-${item.id}`}>
            <StatusIcon size={confirmed ? 14 : 16} color={tint} />
            <Text style={[styles.statusText, { color: tint }]}>{label}</Text>
          </View>
        </FadeIn>
        <Text style={[styles.time, { color: colors.textMuted }]}>{formatMessageTime(item.at)}</Text>
      </View>
    </View>
  );
};

interface RequestCardProps {
  item: RequestItem;
  onPay?: () => void;
  onDecline?: () => void;
}

/** A payment request: asked of us it offers Pay and Decline; asked by us it just tracks. */
export const PaymentRequestCard: React.FC<RequestCardProps> = ({ item, onPay, onDecline }) => {
  const { colors } = useTheme();
  const statusLabel = {
    open: loc.chat.request_card_open,
    paid: loc.chat.request_card_paid,
    declined: loc.chat.request_card_declined,
    expired: loc.chat.request_card_expired,
  }[item.status];
  const done = item.status === 'paid';
  const actionable = !item.mine && item.status === 'open';

  return (
    <View style={[styles.row, item.mine ? styles.rowMine : styles.rowTheirs]}>
      <View
        testID={`ChatRequest-${item.id}`}
        style={[styles.card, { backgroundColor: colors.surfaceBrandSubtle, borderColor: colors.borderDefault }]}
      >
        <View style={styles.head}>
          <PaperPlaneIcon size={16} color={colors.textBrand} />
          <Text style={[styles.title, { color: colors.textBrand }]}>{loc.chat.request_card_title}</Text>
        </View>
        <Text style={[styles.amount, { color: colors.textPrimary }]}>{sats(item.request.amount)}</Text>
        {!!item.request.note && <Text style={[styles.note, { color: colors.textSecondary }]}>{item.request.note}</Text>}
        <FadeIn stateKey={item.status}>
          <View style={styles.status} testID={`ChatRequestStatus-${item.id}`}>
            {done ? <CheckmarkIcon size={14} color={colors.statusSuccess} /> : <ClockIcon size={16} color={colors.textMuted} />}
            <Text style={[styles.statusText, { color: done ? colors.statusSuccess : colors.textMuted }]}>{statusLabel}</Text>
          </View>
        </FadeIn>
        {actionable && (
          <View style={styles.actions}>
            <ActionButton
              title={loc.chat.request_pay}
              Icon={PaperPlaneIcon}
              iconSize={18}
              onPress={() => onPay?.()}
              backgroundColor={colors.brandPrimary}
              color={colors.white}
              style={styles.actionButton}
              testID={`ChatRequestPay-${item.id}`}
            />
            <ActionButton
              title={loc.chat.request_decline}
              onPress={() => onDecline?.()}
              backgroundColor={colors.surfaceSubtle}
              color={colors.textBrand}
              style={styles.actionButton}
              testID={`ChatRequestDecline-${item.id}`}
            />
          </View>
        )}
        <Text style={[styles.time, { color: colors.textMuted }]}>{formatMessageTime(item.at)}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  card: { width: '78%', borderRadius: 18, borderWidth: 0.5, padding: 14, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: ClashFont.medium, fontSize: 14 },
  amount: { fontFamily: ClashFont.semibold, fontSize: 26, letterSpacing: -0.5 },
  note: { fontFamily: ClashFont.regular, fontSize: 15, lineHeight: 20 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  statusText: { fontFamily: ClashFont.medium, fontSize: 14 },
  time: { fontFamily: ClashFont.regular, fontSize: 11, alignSelf: 'flex-end' },
  actions: { gap: 8, marginTop: 6 },
  actionButton: { height: 44 },
});
