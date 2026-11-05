import React, { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import ContactAvatar from '../../components/ContactAvatar';
import SafeArea from '../../components/SafeArea';
import { useTheme } from '../../components/themes';
import { ClashFont } from '../../constants/fonts';
import type { MessageRequest, PeerIndexEntry } from '../../helpers/chat/ChatService';
import { useChat } from '../../helpers/chat/ChatProvider';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';

const shortPubkey = (pubkey: string) => `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;

type Row = { type: 'request'; request: MessageRequest } | { type: 'conversation'; entry: PeerIndexEntry };

/** Invites from people who are not saved contacts: accept to chat, decline to drop. */
const MessageRequests: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();
  const { service, requests, peers } = useChat();

  // Accepted requests have no contact (so no address to open them by): they live here, keyed by pubkey.
  const strangers = peers.filter(p => !service?.addressForPubkey(p.peer));
  const rows: Row[] = [
    ...requests.map((request): Row => ({ type: 'request', request })),
    ...strangers.map((entry): Row => ({ type: 'conversation', entry })),
  ];

  const accept = useCallback(
    async (request: MessageRequest) => {
      await service?.acceptRequest(request.id);
      navigation.navigate('ChatThread', { peer: request.from });
    },
    [service, navigation],
  );

  const decline = useCallback((request: MessageRequest) => service?.declineRequest(request.id), [service]);

  const renderItem = ({ item }: { item: Row }) => {
    const pubkey = item.type === 'request' ? item.request.from : item.entry.peer;
    return (
      <View style={[styles.row, { backgroundColor: colors.surfaceBrandSubtle, borderColor: colors.borderDefault }]}>
        <Pressable
          accessibilityRole="button"
          disabled={item.type === 'request'}
          onPress={() => navigation.navigate('ChatThread', { peer: pubkey })}
          style={styles.identity}
          testID={`MessageRequestRow-${pubkey}`}
        >
          <ContactAvatar name="?" colorIndex={0} size={44} borderRadius={14} />
          <View style={styles.text}>
            <Text style={[styles.name, { color: colors.textPrimary }]}>{loc.chat.requests_unknown}</Text>
            <Text style={[styles.sub, { color: colors.textMuted }]} numberOfLines={1}>
              {shortPubkey(pubkey)}
            </Text>
          </View>
        </Pressable>
        {item.type === 'request' && (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => decline(item.request)}
              style={[styles.pill, { backgroundColor: colors.surfaceSubtle }]}
              testID={`MessageRequestDecline-${pubkey}`}
            >
              <Text style={[styles.pillText, { color: colors.textBrand }]}>{loc.chat.request_decline}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => accept(item.request)}
              style={[styles.pill, { backgroundColor: colors.brandPrimary }]}
              testID={`MessageRequestAccept-${pubkey}`}
            >
              <Text style={[styles.pillText, { color: colors.white }]}>{loc.chat.request_accept}</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeArea style={styles.root}>
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.textMuted }]} testID="MessageRequestsEmpty">
            {loc.chat.requests_empty}
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => (item.type === 'request' ? item.request.id : item.entry.peer)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeArea>
  );
};

export default MessageRequests;

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { gap: 12, paddingHorizontal: 24, paddingVertical: 24 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: ClashFont.regular, fontSize: 15 },
  row: { borderRadius: 16, borderWidth: 0.5, padding: 12, gap: 12 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 4 },
  name: { fontFamily: ClashFont.medium, fontSize: 16 },
  sub: { fontFamily: ClashFont.regular, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  pill: { height: 38, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontFamily: ClashFont.medium, fontSize: 15 },
});
