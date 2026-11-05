import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import { useTheme } from '../../components/themes';
import { ClashFont } from '../../constants/fonts';
import { useChat } from '../../helpers/chat/ChatProvider';
import { getChatRelays } from '../../helpers/chat/relays';
import { useSettings } from '../../hooks/context/useSettings';
import loc from '../../loc';

const ChatSettings: React.FC = () => {
  const { colors } = useTheme();
  const { isChatEnabled, setIsChatEnabledStorage } = useSettings();
  const { status, unavailable } = useChat();

  const cardStyle = [styles.card, { borderColor: colors.borderDefault, backgroundColor: colors.fieldBackground }];

  let statusText: string;
  if (unavailable === 'tor-only') statusText = loc.chat.unavailable_tor_only;
  else if (unavailable) statusText = loc.chat.status_off;
  else if (status === 'ready') statusText = loc.chat.status_connected;
  else if (status === 'starting' || status === 'idle') statusText = loc.chat.status_connecting;
  else statusText = loc.chat.status_stopped;

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content} testID="ChatSettingsScrollView">
      <View style={cardStyle}>
        <SettingsToggleRow
          title={loc.chat.toggle_title}
          subtitle={loc.chat.toggle_subtitle}
          value={isChatEnabled}
          onValueChange={setIsChatEnabledStorage}
          showSeparator={false}
          testID="ChatEnabledSwitch"
        />
      </View>
      <Text style={[styles.status, { color: colors.textMuted }]} testID="ChatStatusText">
        {loc.chat.status_label}: {statusText}
      </Text>

      <Text style={[styles.sectionHeader, styles.sectionHeaderGap, { color: colors.textMuted }]}>{loc.chat.how_header}</Text>
      <View style={[cardStyle, styles.notes]}>
        {[loc.chat.cost_linkable, loc.chat.cost_scan_key, loc.chat.cost_identity].map(text => (
          <Text key={text} style={[styles.note, { color: colors.textSecondary }]}>
            {text}
          </Text>
        ))}
      </View>

      <Text style={[styles.sectionHeader, styles.sectionHeaderGap, { color: colors.textMuted }]}>{loc.chat.relays_header}</Text>
      <View style={[cardStyle, styles.notes]} testID="ChatRelayList">
        {getChatRelays().map(url => (
          <Text key={url} style={[styles.relay, { color: colors.textPrimary }]}>
            {url}
          </Text>
        ))}
      </View>
      <Text style={[styles.footer, { color: colors.textMuted }]}>{loc.chat.relays_footer}</Text>
    </SafeAreaScrollView>
  );
};

export default ChatSettings;

const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 24 },
  sectionHeader: { fontSize: 14, fontFamily: ClashFont.regular, marginBottom: 8, marginLeft: 4 },
  sectionHeaderGap: { marginTop: 24 },
  card: { borderRadius: 16, overflow: 'hidden', borderWidth: 1 },
  notes: { padding: 16, gap: 12 },
  note: { fontFamily: ClashFont.regular, fontSize: 14, lineHeight: 20 },
  relay: { fontFamily: ClashFont.regular, fontSize: 14 },
  status: { fontFamily: ClashFont.regular, fontSize: 13, marginTop: 8, marginLeft: 4 },
  footer: { fontFamily: ClashFont.regular, fontSize: 13, marginTop: 8, marginLeft: 4 },
});
