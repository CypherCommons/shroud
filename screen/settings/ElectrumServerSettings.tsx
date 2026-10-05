import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import DefaultPreference from 'react-native-default-preference';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import SettingsRowWrapper from '../../components/SettingsRowWrapper';
import SettingsCard from '../../components/SettingsCard';
import SettingsSectionHeader from '../../components/SettingsSectionHeader';
import CheckmarkIcon from '../../components/icons/CheckmarkIcon';
import SettingsTextInput from '../../components/SettingsTextInput';
import Button from '../../components/Button';
import presentAlert from '../../components/Alert';
import { useTheme } from '../../components/themes';
import * as Electrum from '../../modules/Electrum';
import { ElectrumServerItem, formatServerAddress, parseElectrumServerString } from '../../modules/Electrum';
import { GROUP_IO_SHROUD } from '../../modules/currency';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';
import { useSettings } from '../../hooks/context/useSettings';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import loc from '../../loc';
import { ClashFont } from '../../constants/fonts';

type RouteProps = RouteProp<DetailViewStackParamList, 'ElectrumServerSettings'>;

const isSameServer = (a?: ElectrumServerItem, b?: ElectrumServerItem): boolean =>
  !!a && !!b && a.host === b.host && a.ssl === b.ssl && a.tcp === b.tcp;

const parseServerInput = (value: string): ElectrumServerItem | null => {
  // Scheme-less input (no ssl:// or tcp:// prefix) defaults to plain TCP, matching the
  // conventional Electrum port split (50001 = tcp, 50002 = ssl) - defaulting to SSL here
  // would silently break a plain-TCP address like 10.20.30.40:50001.
  let ssl = false;
  let rest = value.trim();
  if (rest.startsWith('ssl://')) {
    ssl = true;
    rest = rest.slice(6);
  } else if (rest.startsWith('tcp://')) {
    ssl = false;
    rest = rest.slice(6);
  }

  // Bracketed IPv6 host ([::1]:50002) needs its own match - an IPv6 address's own colons would
  // otherwise be indistinguishable from the port separator.
  const ipv6Match = rest.match(/^\[([^[\]]+)\]:(\d+)$/);
  const parts = ipv6Match ? [ipv6Match[1], ipv6Match[2]] : rest.split(':');

  let server: ElectrumServerItem | null;
  if (parts.length === 3) {
    // host:port:s / host:port:t - same wire format the setelectrumserver deeplink uses.
    server = parseElectrumServerString(rest);
  } else if (parts.length === 2) {
    const host = parts[0].trim();
    const port = Number(parts[1]);
    server = host && Number.isInteger(port) && port > 0 && port <= 65535 ? (ssl ? { host, ssl: port } : { host, tcp: port }) : null;
  } else {
    server = null;
  }

  // SSL is never usable over the Tor tunnel (see Electrum.ts's resolveElectrumTransport) - force
  // tcp for onion hosts regardless of which scheme/format the user typed, since ssl would
  // otherwise silently fail every time.
  if (server?.ssl !== undefined && server.host.endsWith('.onion')) {
    return { host: server.host, tcp: server.ssl };
  }
  return server;
};

interface ServerRowProps {
  server: ElectrumServerItem;
  selected: boolean;
  onPress: () => void;
  showSeparator?: boolean;
  testID?: string;
}

const ServerRow: React.FC<ServerRowProps> = ({ server, selected, onPress, showSeparator = true, testID }) => {
  const { colors } = useTheme();
  return (
    <SettingsRowWrapper showSeparator={showSeparator}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={server.host}
        accessibilityState={{ selected }}
        style={({ pressed }) => [styles.row, pressed && Platform.OS !== 'android' && styles.rowPressed]}
        onPress={onPress}
        testID={testID}
        android_ripple={{ color: colors.borderDefault }}
      >
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{server.host}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>{formatServerAddress(server)}</Text>
        </View>
        {selected && <CheckmarkIcon color={colors.brandPrimary} size={20} />}
      </Pressable>
    </SettingsRowWrapper>
  );
};

const ElectrumServerSettings: React.FC = () => {
  const params = useRoute<RouteProps>().params;
  const { isTorEnabled } = useSettings();
  const [preferredServer, setPreferredServer] = useState<ElectrumServerItem>();
  const [customInput, setCustomInput] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const refreshPreferredServer = useCallback(async () => {
    setPreferredServer(await Electrum.getPreferredServer());
  }, []);

  useEffect(() => {
    refreshPreferredServer();
  }, [refreshPreferredServer]);

  // TODO: once a server is saved here there's no UI path back to unset it and resume
  // connectMain's random peer selection - a "Reset to default" row is needed.
  const saveServer = useCallback(
    async (server: ElectrumServerItem) => {
      // Onion hosts can only ever connect through the Tor SOCKS5 tunnel (see Electrum.ts's
      // resolveElectrumTransport), which requires the user's Tor setting to be on - catch that
      // here so the failure says so, instead of the generic "can't connect" message.
      if (server.host.endsWith('.onion') && !isTorEnabled) {
        presentAlert({ message: loc.settings.electrum_error_onion_requires_tor });
        return;
      }

      setIsConnecting(true);
      try {
        const testOk = await Electrum.testConnection(server.host, server.tcp, server.ssl);
        if (!testOk) {
          presentAlert({
            message: server.host.endsWith('.onion') ? loc.settings.electrum_error_connect_tor : loc.settings.electrum_error_connect,
          });
          return;
        }

        await DefaultPreference.setName(GROUP_IO_SHROUD);
        // The preferred server belongs to the active chain only; see `electrumPreferenceKeys`.
        const keys = Electrum.electrumPreferenceKeys();
        await DefaultPreference.set(keys.host, server.host);
        await DefaultPreference.set(keys.tcp, server.tcp ? String(server.tcp) : '');
        await DefaultPreference.set(keys.ssl, server.ssl ? String(server.ssl) : '');

        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        presentAlert({ message: loc.settings.electrum_saved });
        setCustomInput('');
        await refreshPreferredServer();
      } catch (error) {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        presentAlert({ message: error instanceof Error ? error.message : String(error) });
      } finally {
        setIsConnecting(false);
      }
    },
    [refreshPreferredServer, isTorEnabled],
  );

  useEffect(() => {
    if (!params?.server) return;
    const server = params.server;
    triggerHapticFeedback(HapticFeedbackTypes.ImpactHeavy);
    Alert.alert(
      loc.formatString(loc.settings.set_electrum_server_as_default, { server: server.host }),
      '',
      [
        { text: loc._.ok, onPress: () => saveServer(server), style: 'default' },
        { text: loc._.cancel, onPress: () => {}, style: 'cancel' },
      ],
      { cancelable: false },
    );
  }, [params?.server, saveServer]);

  const parsedCustom = customInput.trim() ? parseServerInput(customInput) : null;
  // Per active chain, and empty on one that ships no public servers (signet).
  const suggestedServers = Electrum.getSuggestedServers();

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="always" testID="ElectrumServerSettingsScrollView">
      {suggestedServers.length > 0 && (
        <>
          <SettingsSectionHeader>{loc.settings.electrum_trusted_servers}</SettingsSectionHeader>
          <SettingsCard>
            {suggestedServers.map((server, index) => (
              <ServerRow
                key={`${server.host}:${server.ssl ?? server.tcp}`}
                server={server}
                selected={isSameServer(server, preferredServer)}
                onPress={() => saveServer(server)}
                showSeparator={index < suggestedServers.length - 1}
                testID={`ElectrumServerOption-${server.host}`}
              />
            ))}
          </SettingsCard>
        </>
      )}

      <SettingsSectionHeader style={suggestedServers.length > 0 ? styles.sectionHeaderGap : undefined}>
        {loc.settings.electrum_custom_server}
      </SettingsSectionHeader>
      <SettingsCard>
        <View style={styles.customServerContent}>
          <SettingsTextInput
            testID="CustomServerInput"
            placeholder={loc.settings.electrum_custom_server_placeholder}
            value={customInput}
            onChangeText={setCustomInput}
            editable={!isConnecting}
            keyboardType="url"
          />
          <Button
            testID="ConnectCustomServer"
            title={loc.settings.electrum_connect_custom_server}
            disabled={!parsedCustom || isConnecting}
            onPress={() => parsedCustom && saveServer(parsedCustom)}
            style={styles.connectButton}
          />
        </View>
      </SettingsCard>
    </SafeAreaScrollView>
  );
};

export default ElectrumServerSettings;

const styles = StyleSheet.create({
  content: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  sectionHeaderGap: {
    marginTop: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowText: {
    flexShrink: 1,
    marginRight: 12,
  },
  rowTitle: {
    fontSize: 16,
    fontFamily: ClashFont.medium,
  },
  rowSubtitle: {
    fontSize: 13,
    fontFamily: ClashFont.regular,
    marginTop: 8,
  },
  customServerContent: {
    padding: 16,
  },
  connectButton: {
    marginTop: 16,
  },
});
