import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, ListRenderItemInfo, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useIsFocused, useRoute } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import presentAlert from '../../components/Alert';
import ChatBubble from '../../components/chat/ChatBubble';
import ChatComposer from '../../components/chat/ChatComposer';
import RequestPaymentSheet from '../../components/chat/RequestPaymentSheet';
import { PaymentNoticeCard, PaymentRequestCard } from '../../components/chat/PaymentCard';
import ContactAvatar from '../../components/ContactAvatar';
import { useTheme } from '../../components/themes';
import { ClashFont } from '../../constants/fonts';
import { PeerNotOnChatError, type ThreadItem } from '../../helpers/chat/ChatService';
import { useChat, useChatPeer, useChatThread, useIsOnChat } from '../../helpers/chat/ChatProvider';
import { requestBelongsToSender } from '../../helpers/chat/requests';
import { getActiveNetwork } from '../../modules/network';
import { useContacts } from '../../hooks/context/useContacts';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useSendToAddress } from '../../hooks/useSendToAddress';
import loc from '../../loc';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'ChatThread'>;

const shortPubkey = (pubkey: string) => `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`;

const ChatThread: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();
  const headerHeight = useHeaderHeight();
  const isFocused = useIsFocused();
  const { params } = useRoute<RouteProps>();
  const target = params.address ?? params.peer;
  const { service, unavailable, needsTorNotice, dismissTorNotice, peers } = useChat();
  const { getContact } = useContacts();
  const sendToAddress = useSendToAddress();

  const contact = params.address ? getContact(params.address) : undefined;
  const peer = useChatPeer(target);
  const name = contact?.name ?? (peer ? shortPubkey(peer) : loc.chat.requests_unknown);
  const { items, loading } = useChatThread(target);
  const hasConversation = peers.some(p => p.peer === peer);
  const onChat = useIsOnChat(hasConversation ? undefined : target);
  const canMessage = hasConversation || onChat === true;

  const HeaderTitle = useMemo(
    () => (
      <View style={styles.headerTitle}>
        <ContactAvatar name={contact?.name ?? '?'} colorIndex={contact?.colorIndex ?? 0} size={32} borderRadius={10} />
        <Text style={[styles.headerName, { color: colors.textPrimary }]} numberOfLines={1} testID="ChatThreadName">
          {name}
        </Text>
      </View>
    ),
    [contact?.name, contact?.colorIndex, name, colors.textPrimary],
  );

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: () => HeaderTitle });
  }, [navigation, HeaderTitle]);

  // Tor is on but chat goes direct: say so once.
  useEffect(() => {
    if (!needsTorNotice) return;
    presentAlert({ title: loc.chat.tor_notice_title, message: loc.chat.tor_notice_message });
    dismissTorNotice();
  }, [needsTorNotice, dismissTorNotice]);

  // Read while open: anything that arrives with the thread on screen does not stay unread.
  const unread = peers.find(p => p.peer === peer)?.unread ?? 0;
  useEffect(() => {
    if (isFocused && service && peer && unread > 0) service.markRead(peer).catch(() => undefined);
  }, [isFocused, service, peer, unread, items.length]);

  const onSend = useCallback(
    async (text: string): Promise<boolean> => {
      if (!service || !target) return false;
      try {
        await service.sendText(target, text);
        return true;
      } catch (e) {
        const message =
          e instanceof PeerNotOnChatError ? (loc.formatString(loc.chat.not_on_chat, { name }) as string) : loc.chat.send_failed;
        presentAlert({ message });
        return false;
      }
    },
    [service, target, name],
  );

  const [requestOpen, setRequestOpen] = useState(false);
  const onRequest = useMemo(() => (params.address ? () => setRequestOpen(true) : undefined), [params.address]);

  const submitRequest = useCallback(
    async ({ amount, note }: { amount: number; note?: string }) => {
      setRequestOpen(false);
      if (!service || !target) return;
      try {
        await service.sendRequest(target, { address: service.address, amount, note });
      } catch (e) {
        presentAlert({ message: loc.chat.send_failed });
      }
    },
    [service, target],
  );

  const payRequest = useCallback(
    (item: Extract<ThreadItem, { kind: 'request' }>) => {
      if (!peer) return;
      // Pay only an address that is the sender's own; see requestBelongsToSender.
      if (!requestBelongsToSender(item.request.address, peer, getActiveNetwork().bitcoinjs)) {
        presentAlert({ message: loc.chat.request_wrong_sender });
        return;
      }
      sendToAddress(item.request.address, { amountSats: item.request.amount, memo: item.request.note, chatRequestId: item.id });
    },
    [peer, sendToAddress],
  );

  const declineRequest = useCallback((item: Extract<ThreadItem, { kind: 'request' }>) => service?.declineRequestCard(item.id), [service]);

  const onPay = useMemo(() => (params.address ? () => sendToAddress(params.address) : undefined), [params.address, sendToAddress]);

  const renderItem = useCallback(
    (info: ListRenderItemInfo<ThreadItem>) => {
      const item = info.item;
      switch (item.kind) {
        case 'text':
          return <ChatBubble text={item.text} mine={item.mine} at={item.at} testID={`ChatMessage-${item.id}`} />;
        case 'notice':
          return <PaymentNoticeCard item={item} name={name} />;
        default:
          return <PaymentRequestCard item={item} onPay={() => payRequest(item)} onDecline={() => declineRequest(item)} />;
      }
    },
    [name, payRequest, declineRequest],
  );

  let notice: string | undefined;
  if (unavailable === 'disabled') notice = loc.chat.chat_off;
  else if (unavailable === 'tor-only') notice = loc.chat.unavailable_tor_only;
  else if (!service) notice = loc.chat.loading;
  else if (!canMessage && onChat === false) notice = loc.formatString(loc.chat.not_on_chat, { name }) as string;

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.textMuted }]} testID="ChatEmpty">
            {loading && service ? loc.chat.loading : loc.chat.empty_thread}
          </Text>
        </View>
      ) : (
        <FlatList
          inverted
          data={items}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          testID="ChatThreadList"
        />
      )}
      {notice !== undefined && (
        <View style={[styles.banner, { backgroundColor: colors.surfaceCaution }]}>
          <Text style={[styles.bannerText, { color: colors.textCaution }]} testID="ChatBanner">
            {notice}
          </Text>
        </View>
      )}
      <ChatComposer onSend={onSend} onPay={onPay} onRequest={onRequest} disabled={!service || !canMessage} />
      <RequestPaymentSheet visible={requestOpen} onClose={() => setRequestOpen(false)} onSubmit={submitRequest} />
    </KeyboardAvoidingView>
  );
};

export default ChatThread;

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerName: { fontFamily: ClashFont.medium, fontSize: 18, maxWidth: 200 },
  list: { paddingHorizontal: 16, paddingVertical: 16, gap: 10 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: { fontFamily: ClashFont.regular, fontSize: 15, textAlign: 'center' },
  banner: { paddingVertical: 10, paddingHorizontal: 16 },
  bannerText: { fontFamily: ClashFont.medium, fontSize: 14, textAlign: 'center' },
});
