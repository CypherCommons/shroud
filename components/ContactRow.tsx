import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { ContactListItem } from '../class/contacts';
import { shortenAddress } from '../utils/transactionHelpers';
import ContactAvatar from './ContactAvatar';
import ChatIcon from './icons/ChatIcon';
import ChevronRightIcon from './icons/ChevronRightIcon';
import PaperPlaneIcon from './icons/PaperPlaneIcon';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';
import loc from '../loc';

/** What the contact list shows of a contact's Shroud chat. Absent while chat is off or not yet looked up. */
export type ContactChatInfo = {
  onShroud: boolean;
  unread: number;
  /** The last message, already worded for the row. */
  preview?: string;
};

type ContactRowProps = {
  contact: ContactListItem;
  // Handlers take the address rather than close over it, so a list can hold one stable callback
  // per action and let the React.memo below actually skip untouched rows.
  onPress: (address: string) => void;
  testID: string;
  /** Spacing is the list's to set: neither variant carries a margin of its own. */
  style?: StyleProp<ViewStyle>;
  /** The bare row shows the badge, preview and unread count; the card only its unread count. */
  chat?: ContactChatInfo;
} & (
  | // Bare row that opens the contact, for a screen whose whole job is the list.
  { variant?: 'row' }
  // Bordered card carrying its own pay action, for a list sharing a screen with other content.
  // `onMessage` adds a chat shortcut beside Pay; leave it out while chat is off.
  | { variant: 'card'; onPay: (address: string) => void; onMessage?: (address: string) => void }
);

const ContactRow: React.FC<ContactRowProps> = props => {
  const { contact, onPress, testID, style, chat } = props;
  const { colors } = useTheme();
  const isCard = props.variant === 'card';

  const identity = (
    <>
      <ContactAvatar name={contact.name} colorIndex={contact.colorIndex} size={48} borderRadius={16} />
      <View style={[styles.text, isCard ? styles.cardText : styles.rowText]}>
        <View style={styles.nameLine}>
          <Text style={[styles.rowName, styles.nameText, { color: colors.textPrimary }]} numberOfLines={1}>
            {contact.name}
          </Text>
          {!isCard && chat?.onShroud && (
            <View style={[styles.badge, { backgroundColor: colors.surfaceSubtle }]} testID={`${testID}-OnShroud`}>
              <Text style={[styles.badgeText, { color: colors.textBrand }]}>{loc.chat.on_shroud}</Text>
            </View>
          )}
        </View>
        <Text style={[styles.rowAddress, { color: colors.textMuted }]} numberOfLines={1}>
          {!isCard && chat?.preview ? chat.preview : shortenAddress(contact.address, 8)}
        </Text>
      </View>
    </>
  );

  if (props.variant !== 'card') {
    return (
      <Pressable accessibilityRole="button" style={[styles.row, style]} onPress={() => onPress(contact.address)} testID={testID}>
        {identity}
        {chat && chat.unread > 0 ? (
          <View style={[styles.unread, { backgroundColor: colors.brandPrimary }]} testID={`${testID}-Unread`}>
            <Text style={[styles.unreadText, { color: colors.white }]}>{chat.unread > 99 ? '99+' : chat.unread}</Text>
          </View>
        ) : (
          <ChevronRightIcon color={colors.iconSecondary} />
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.card, { backgroundColor: colors.surfaceBrandSubtle, borderColor: colors.borderDefault }, style]}
      onPress={() => onPress(contact.address)}
      testID={testID}
    >
      {identity}
      {props.onMessage && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${loc.chat.message} ${contact.name}`}
          style={[styles.message, { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderDefault }]}
          onPress={() => props.onMessage?.(contact.address)}
          testID={`${testID}-Message`}
        >
          <ChatIcon size={20} color={colors.textBrand} />
          {chat && chat.unread > 0 && (
            <View
              style={[styles.messageDot, { backgroundColor: colors.brandPrimary, borderColor: colors.surfaceBrandSubtle }]}
              testID={`${testID}-MessageUnread`}
            >
              <Text style={[styles.messageDotText, { color: colors.white }]}>{chat.unread > 9 ? '9+' : chat.unread}</Text>
            </View>
          )}
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${loc.contacts.pay} ${contact.name}`}
        style={[styles.pay, { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderDefault }]}
        onPress={() => props.onPay(contact.address)}
        testID={`${testID}-Pay`}
      >
        <PaperPlaneIcon size={16} color={colors.textBrand} />
        <Text style={[styles.payText, { color: colors.textBrand }]}>{loc.contacts.pay}</Text>
      </Pressable>
    </Pressable>
  );
};

// Sits in the same lists as TransactionListItem, which is memoised for the same reason: the
// screens above it re-render on every keystroke and balance poll.
export default React.memo(ContactRow);

const styles = StyleSheet.create({
  // Vertical rhythm comes from the list's gap, not from padding of its own.
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    minHeight: 77,
    borderRadius: 16,
    borderWidth: 0.5,
    paddingHorizontal: 12,
  },
  text: { flex: 1 },
  rowText: { gap: 12 },
  cardText: { gap: 4 },
  rowName: { fontFamily: ClashFont.medium, fontSize: 16, lineHeight: 20 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameText: { flexShrink: 1 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontFamily: ClashFont.medium, fontSize: 11 },
  unread: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  unreadText: { fontFamily: ClashFont.medium, fontSize: 13 },
  rowAddress: { fontFamily: ClashFont.regular, fontSize: 14, lineHeight: 17 },
  message: { width: 40, height: 40, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  messageDot: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageDotText: { fontFamily: ClashFont.medium, fontSize: 10 },
  pay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  payText: { fontFamily: ClashFont.medium, fontSize: 16, lineHeight: 24 },
});
