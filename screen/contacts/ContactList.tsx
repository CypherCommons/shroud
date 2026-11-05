import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ContactListItem, searchContacts } from '../../class/contacts';
import ContactRow, { ContactChatInfo } from '../../components/ContactRow';
import ContactsEmptyState from '../../components/ContactsEmptyState';
import SafeArea from '../../components/SafeArea';
import SearchField from '../../components/SearchField';
import { useTheme } from '../../components/themes';
import AddIcon from '../../components/icons/AddIcon';
import HeaderBarButton from '../../components/HeaderBarButton';
import ChatIcon from '../../components/icons/ChatIcon';
import ChevronRightIcon from '../../components/icons/ChevronRightIcon';
import { ClashFont } from '../../constants/fonts';
import type { LastMessage } from '../../helpers/chat/ChatService';
import { useChat, useChatDiscovery } from '../../helpers/chat/ChatProvider';
import { useContacts } from '../../hooks/context/useContacts';
import loc, { formatBalance } from '../../loc';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { hasLiquidGlass } from '../../modules/environment';

const previewOf = (last: LastMessage | undefined): string | undefined => {
  if (!last) return undefined;
  if (last.kind === 'text') return `${last.mine ? '↗ ' : ''}${last.text ?? ''}`;
  const amount = formatBalance(last.amount ?? 0, BitcoinUnit.SATS, true);
  if (last.kind === 'request') return loc.formatString(loc.chat.preview_requested, { amount }) as string;
  return loc.formatString(last.mine ? loc.chat.preview_sent : loc.chat.preview_received, { amount }) as string;
};

const ContactList: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();
  const { contactList } = useContacts();
  const [query, setQuery] = useState('');
  const { service, peers, requests } = useChat();
  const discovered = useChatDiscovery(useMemo(() => contactList.map(c => c.address), [contactList]));

  const chatByAddress = useMemo(() => {
    const map = new Map<string, ContactChatInfo>();
    if (!service) return map;
    for (const contact of contactList) {
      const peerPubkey = service.resolvePeer(contact.address);
      if (!peerPubkey) continue;
      const entry = peers.find(p => p.peer === peerPubkey);
      const onShroud = !!entry || discovered.has(peerPubkey);
      if (onShroud) map.set(contact.address, { onShroud, unread: entry?.unread ?? 0, preview: previewOf(entry?.lastMessage) });
    }
    return map;
  }, [service, contactList, peers, discovered]);

  const results = useMemo(() => searchContacts(contactList, query), [contactList, query]);

  const openAdd = useCallback(() => navigation.navigate('ContactEdit', { mode: 'add' }), [navigation]);

  const openDetail = useCallback((address: string) => navigation.navigate('ContactDetail', { address }), [navigation]);

  // Prefixed: WalletsList's card variant carries its own `HomeContact-` ids, and Home stays mounted
  // underneath this screen, so a bare `Contact-` id would match two different rows.
  const renderItem = useCallback(
    (p: { item: ContactListItem }) => (
      <ContactRow
        contact={p.item}
        onPress={openDetail}
        chat={chatByAddress.get(p.item.address)}
        testID={`ContactListContact-${p.item.address}`}
      />
    ),
    [openDetail, chatByAddress],
  );

  const HeaderRight = useMemo(
    () => (
      <HeaderBarButton
        accessibilityLabel={loc.contacts.add}
        onPress={openAdd}
        testID="AddContactButton"
        backgroundStyle={[styles.add, { backgroundColor: colors.brandPrimary, borderColor: colors.background }]}
      >
        {/* On glass the "+" sits on the bar's capsule rather than a purple square, so it takes the brand color. */}
        <AddIcon size={24} color={hasLiquidGlass ? colors.brandPrimary : colors.white} />
      </HeaderBarButton>
    ),
    [openAdd, colors.brandPrimary, colors.white, colors.background],
  );

  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: contactList.length > 0 ? () => HeaderRight : undefined });
  }, [navigation, HeaderRight, contactList.length]);

  if (contactList.length === 0) {
    return (
      <SafeArea style={styles.root}>
        <View style={styles.emptyState}>
          <ContactsEmptyState onAdd={openAdd} bordered={false} />
        </View>
      </SafeArea>
    );
  }

  return (
    <SafeArea style={styles.root}>
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={loc.contacts.search_placeholder}
        style={styles.searchField}
        testID="ContactSearchInput"
      />
      {requests.length > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('ChatRequests')}
          style={[styles.requests, { backgroundColor: colors.surfaceBrandSubtle, borderColor: colors.borderDefault }]}
          testID="MessageRequestsRow"
        >
          <ChatIcon size={24} color={colors.brandPrimary} />
          <View style={styles.requestsText}>
            <Text style={[styles.requestsTitle, { color: colors.textPrimary }]}>{loc.chat.requests_title}</Text>
            <Text style={[styles.requestsSub, { color: colors.textMuted }]}>{loc.chat.requests_subtitle}</Text>
          </View>
          <View style={[styles.requestsCount, { backgroundColor: colors.brandPrimary }]}>
            <Text style={[styles.requestsCountText, { color: colors.white }]}>{requests.length}</Text>
          </View>
          <ChevronRightIcon color={colors.iconSecondary} />
        </Pressable>
      )}
      <FlatList
        data={results}
        keyExtractor={item => item.address}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        renderItem={renderItem}
      />
    </SafeArea>
  );
};

export default ContactList;

const styles = StyleSheet.create({
  root: { flex: 1 },
  // This screen *is* the empty state, so it centres the card itself rather than asking the shared
  // component to nudge itself up out of a list footer's position.
  emptyState: { flex: 1, justifyContent: 'center', paddingBottom: 96 },
  searchField: { marginHorizontal: 24, marginTop: 16 },
  add: { borderRadius: 8, borderWidth: 1.63 },
  requests: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 24,
    marginTop: 16,
    padding: 12,
    borderRadius: 16,
    borderWidth: 0.5,
  },
  requestsText: { flex: 1, gap: 2 },
  requestsTitle: { fontFamily: ClashFont.medium, fontSize: 16 },
  requestsSub: { fontFamily: ClashFont.regular, fontSize: 13 },
  requestsCount: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  requestsCountText: { fontFamily: ClashFont.medium, fontSize: 13 },
  // Rows are bare here, so the 16pt rhythm is the list's to set.
  listContent: { gap: 16, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24 },
});
