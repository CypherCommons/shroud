import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { useContacts } from '../../hooks/context/useContacts';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';
import { ChatService, type ChatStatus, type MessageRequest, type PeerIndexEntry, type ThreadItem } from './ChatService';
import { deriveChatIdentity } from './identity';
import { ChatNetwork } from './network';
import { electrumChain } from './electrumChain';
import { PaymentTracker } from './PaymentTracker';

/** Why chat is not running, when it isn't. `undefined` means it is (or is starting). */
export type ChatUnavailableReason = 'disabled' | 'tor-only' | 'no-wallet';

export interface ChatContextType {
  /** The live service, once started. Undefined while starting, disabled or unavailable. */
  service?: ChatService;
  status: ChatStatus;
  unavailable?: ChatUnavailableReason;
  /** Conversations, most recent first. */
  peers: PeerIndexEntry[];
  requests: MessageRequest[];
  totalUnread: number;
  /** Tor is on but not Tor-only: chat still uses the clearnet, and the user has not been told yet. */
  needsTorNotice: boolean;
  dismissTorNotice: () => void;
}

const defaultValue: ChatContextType = {
  status: 'idle',
  unavailable: 'no-wallet',
  peers: [],
  requests: [],
  totalUnread: 0,
  needsTorNotice: false,
  dismissTorNotice: () => {},
};

export const ChatContext = createContext<ChatContextType>(defaultValue);

/**
 * Runs one ChatService for the active wallet once storage is unlocked. It stops, and starts again for
 * the new identity, when the wallet, decoy bucket or network changes; it stays off while chat is
 * disabled or Tor-only is on (React Native's WebSocket cannot go through SOCKS).
 *
 * Chat does not stop when the app re-locks: AppLock is only an auth gate here (the seed stays in
 * memory), so stopping would just churn connections. It resumes on return to the foreground to
 * re-subscribe and backfill what arrived while the sockets were down.
 */
export const ChatProvider = ({ children }: { children: React.ReactNode }) => {
  const { wallets, walletsInitialized } = useStorage();
  const { isChatEnabled, isTorOnly, isTorEnabled, chatTorNoticeSeen, setChatTorNoticeSeenStorage } = useSettings();
  const { contactList } = useContacts();

  const wallet = walletsInitialized ? (wallets[0] as HDSilentPaymentsWallet | undefined) : undefined;
  const walletId = wallet?.getID();
  const networkId = wallet?.getNetworkConfig().id;
  const unavailable: ChatUnavailableReason | undefined = !isChatEnabled
    ? 'disabled'
    : isTorOnly
      ? 'tor-only'
      : !wallet
        ? 'no-wallet'
        : undefined;

  const contactsRef = useRef<string[]>([]);
  const walletRef = useRef(wallet);
  // Kept current after each render; the service effect and its callbacks read them, never render.
  useEffect(() => {
    contactsRef.current = contactList.map(c => c.address);
    walletRef.current = wallet;
  });

  const [service, setService] = useState<ChatService | undefined>();
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const current = walletRef.current;
    if (unavailable || !current) {
      setService(undefined);
      setStatus('idle');
      return undefined;
    }
    let cancelled = false;
    let svc: ChatService | undefined;
    let network: ChatNetwork | undefined;
    let tracker: PaymentTracker | undefined;
    const offs: (() => void)[] = [];

    (async () => {
      try {
        const net = current.getNetworkConfig();
        const identity = deriveChatIdentity(current._getSeed(), net);
        network = new ChatNetwork({ secretKey: identity.secretKey });
        svc = new ChatService({
          identity,
          network,
          backend: AsyncStorage,
          networkId: net.id,
          bitcoinNetwork: net.bitcoinjs,
          getContactAddresses: () => contactsRef.current,
          log: (message, error) => console.log(`[chat] ${message}`, error ?? ''),
        });
        offs.push(svc.on('status', setStatus));
        offs.push(svc.on('index', () => setVersion(v => v + 1)));
        await svc.start();
        if (cancelled) throw new Error('cancelled');
        // Payment notices become card states and receipts, with the wallet finding the payment.
        tracker = new PaymentTracker(svc, current, electrumChain, {
          log: (message, error) => console.log(`[chat] ${message}`, error ?? ''),
        });
        await tracker.start();
        setService(svc);
        setStatus(svc.status);
      } catch (e) {
        if (!cancelled) console.warn('[chat] could not start', e);
        tracker?.stop();
        await svc?.stop().catch(() => undefined);
        network?.destroy();
        svc = network = tracker = undefined;
      }
    })();

    return () => {
      cancelled = true;
      offs.forEach(off => off());
      setService(undefined);
      tracker?.stop();
      const stopping = svc;
      const net = network;
      if (stopping) {
        stopping
          .stop()
          .catch(() => undefined)
          .finally(() => net?.destroy());
      } else {
        // Still starting: the async block above stops and destroys it once start() returns.
      }
    };
    // The identity is fixed by wallet and network; contacts are read through a ref.
  }, [walletId, networkId, unavailable]);

  // A request from someone newly saved as a contact is accepted on its own.
  useEffect(() => {
    service?.refreshContacts().catch(() => undefined);
  }, [service, contactList]);

  useEffect(() => {
    if (!service) return undefined;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') service.resume().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [service]);

  const dismissTorNotice = useCallback(() => {
    setChatTorNoticeSeenStorage(true).catch(() => undefined);
  }, [setChatTorNoticeSeenStorage]);

  const value = useMemo<ChatContextType>(
    () => ({
      service,
      status,
      unavailable,
      peers: service ? service.listPeers() : [],
      requests: service ? service.getRequests() : [],
      totalUnread: service ? service.totalUnread() : 0,
      needsTorNotice: !!isChatEnabled && isTorEnabled && !isTorOnly && !chatTorNoticeSeen,
      dismissTorNotice,
    }),
    // `version` bumps whenever the service's index changes, so the lists above are re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [service, status, unavailable, version, isChatEnabled, isTorEnabled, isTorOnly, chatTorNoticeSeen, dismissTorNotice],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = (): ChatContextType => useContext(ChatContext);

/** The chat pubkey for a contact address or raw pubkey, or undefined (service not ready, bad address). */
export function useChatPeer(target: string | undefined): string | undefined {
  const { service } = useChat();
  return useMemo(() => (service && target ? service.resolvePeer(target) : undefined), [service, target]);
}

/** Chat pubkeys of the given contacts that can be messaged, from one batched lookup. Empty until it answers. */
export function useChatDiscovery(addresses: string[]): Set<string> {
  const { service } = useChat();
  const [found, setFound] = useState<{ service: ChatService; key: string; peers: Set<string> } | undefined>();
  const key = addresses.join(',');
  useEffect(() => {
    if (!service || addresses.length === 0) return undefined;
    let alive = true;
    service
      .discover(addresses)
      .then(peers => {
        if (alive) setFound({ service, key, peers });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // `key` stands for the address list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, key]);
  return found && found.service === service && found.key === key ? found.peers : EMPTY_SET;
}

const EMPTY_SET: Set<string> = new Set();

/** Whether a contact can be messaged: `undefined` while checking. A conversation already existing counts. */
export function useIsOnChat(address: string | undefined): boolean | undefined {
  const { service } = useChat();
  // Keyed by what was asked, so a stale answer for another contact is never shown while a new one loads.
  const [answer, setAnswer] = useState<{ service: ChatService; address: string; onChat: boolean } | undefined>();
  useEffect(() => {
    if (!service || !address) return undefined;
    let alive = true;
    service
      .isOnChat(address)
      .catch(() => false)
      .then(onChat => {
        if (alive) setAnswer({ service, address, onChat });
      });
    return () => {
      alive = false;
    };
  }, [service, address]);
  return answer && answer.service === service && answer.address === address ? answer.onChat : undefined;
}

/** A conversation's items (newest first), kept live. */
export function useChatThread(address: string | undefined): { items: ThreadItem[]; loading: boolean } {
  const { service } = useChat();
  const [loaded, setLoaded] = useState<{ service: ChatService; address: string; items: ThreadItem[] } | undefined>();
  useEffect(() => {
    if (!service || !address) return undefined;
    const peer = service.resolvePeer(address);
    if (!peer) return undefined;
    const state = { alive: true, running: false, again: false };
    const load = async () => {
      if (state.running) {
        state.again = true;
        return;
      }
      state.running = true;
      try {
        do {
          state.again = false;
          const items = await service.getThread(peer);
          if (state.alive) setLoaded({ service, address, items });
        } while (state.again && state.alive);
      } catch (e) {
        console.warn('[chat] could not load thread', e);
      } finally {
        state.running = false;
      }
    };
    load();
    const off = service.on('thread', p => {
      if (p === peer) load();
    });
    return () => {
      state.alive = false;
      off();
    };
  }, [service, address]);
  const current = loaded && loaded.service === service && loaded.address === address ? loaded : undefined;
  return { items: current?.items ?? [], loading: !!address && !current };
}
