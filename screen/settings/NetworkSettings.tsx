import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import SettingsNavRow from '../../components/SettingsNavRow';
import SettingsStatRow from '../../components/SettingsStatRow';
import SettingsCard from '../../components/SettingsCard';
import SettingsSectionHeader from '../../components/SettingsSectionHeader';
import StatusDotIcon from '../../components/icons/StatusDotIcon';
import { useTheme } from '../../components/themes';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useStorage } from '../../hooks/context/useStorage';
import { useSettings } from '../../hooks/context/useSettings';
import * as Electrum from '../../modules/Electrum';
import { getNetwork } from '../../modules/network';
import loc from '../../loc';
import { ClashFont } from '../../constants/fonts';

type ElectrumConfig = Partial<Awaited<ReturnType<typeof Electrum.getConfig>>>;

const NetworkSettings: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();
  const { scanState, activeNetworkId } = useStorage();
  const { selectedBlockExplorer } = useSettings();
  const [config, setConfig] = useState<ElectrumConfig>({});
  const [preferredServer, setPreferredServer] = useState<Electrum.ElectrumServerItem>();

  useFocusEffect(
    useCallback(() => {
      Electrum.getPreferredServer().then(setPreferredServer);

      const pollConfig = async () => {
        let next: ElectrumConfig;
        try {
          next = await Electrum.getConfig();
        } catch {
          next = {};
        }
        // Every field is a primitive, so a shallow compare is enough to detect "nothing changed"
        // and return the previous object - that lets React bail out of the re-render entirely,
        // instead of re-rendering on every 2s tick regardless of whether anything moved.
        setConfig(prev =>
          prev.host === next.host && prev.port === next.port && prev.serverName === next.serverName && prev.connected === next.connected
            ? prev
            : next,
        );
      };
      pollConfig();
      const id = setInterval(pollConfig, 2000);
      return () => clearInterval(id);
    }, []),
  );

  const isConnected = !!config.connected;
  const { status, lastScannedBlock, progress } = scanState;

  let blockHeightText = '—';
  let syncStatusText = loc.settings.network_status_not_synced;
  let syncStatusColor = colors.textMuted;

  if (status === 'idle' && lastScannedBlock > 0) {
    blockHeightText = lastScannedBlock.toLocaleString();
    syncStatusText = loc.settings.network_status_synced;
    syncStatusColor = colors.brandPrimary;
  } else if (status === 'scanning') {
    blockHeightText = (progress?.currentBlock ?? lastScannedBlock).toLocaleString();
    syncStatusText = loc.settings.network_status_syncing;
  } else if (status === 'paused') {
    blockHeightText = (progress?.currentBlock ?? lastScannedBlock).toLocaleString();
    syncStatusText = loc.settings.network_status_paused;
  } else if (status === 'error') {
    syncStatusText = loc.settings.network_status_error;
    syncStatusColor = colors.statusError;
  }

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content} testID="NetworkSettingsScrollView">
      <SettingsSectionHeader>{loc.settings.bitcoin_network}</SettingsSectionHeader>
      <SettingsCard>
        <SettingsNavRow
          title={getNetwork(activeNetworkId).displayName}
          onPress={() => navigation.navigate('BitcoinNetworkSettings')}
          showSeparator={false}
          testID="BitcoinNetworkRow"
        />
      </SettingsCard>

      <SettingsSectionHeader style={styles.sectionHeaderGap}>{loc.settings.network_section_authentication}</SettingsSectionHeader>
      <SettingsCard>
        <View style={styles.serverRow}>
          <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{loc.settings.network_server}</Text>
          <StatusDotIcon size={16} color={isConnected ? colors.statusSuccess : colors.statusError} />
        </View>
        {config.host ? (
          <View style={[styles.addressBar, { backgroundColor: colors.background }]}>
            <Text style={[styles.serverAddress, { color: colors.textPrimary }]}>
              {preferredServer &&
              preferredServer.host === config.host &&
              (preferredServer.ssl === config.port || preferredServer.tcp === config.port)
                ? Electrum.formatServerAddress(preferredServer)
                : `${config.host}:${config.port}`}
            </Text>
          </View>
        ) : null}
        <SettingsNavRow
          title={loc.settings.network_change_server}
          onPress={() => navigation.navigate('ElectrumServerSettings')}
          showSeparator={false}
          testID="ChangeServerRow"
        />
      </SettingsCard>

      <SettingsSectionHeader style={styles.sectionHeaderGap}>{loc.settings.network_section_privacy}</SettingsSectionHeader>
      <SettingsCard>
        <SettingsNavRow
          title={loc.settings.tor_connect_via_tor}
          onPress={() => navigation.navigate('TorSettings')}
          showSeparator={false}
          testID="ConnectViaTorRow"
        />
      </SettingsCard>

      <SettingsSectionHeader style={styles.sectionHeaderGap}>{loc.settings.network_section_block_explorer}</SettingsSectionHeader>
      <SettingsCard>
        <SettingsNavRow
          title={loc.settings.block_explorer_explorer}
          value={selectedBlockExplorer.name}
          onPress={() => navigation.navigate('BlockExplorerSettings')}
          showSeparator={false}
          testID="ExplorerRow"
        />
      </SettingsCard>

      <SettingsSectionHeader style={styles.sectionHeaderGap}>{loc.settings.network_section_status}</SettingsSectionHeader>
      <SettingsCard>
        <SettingsStatRow title={loc.settings.network_block_height} value={blockHeightText} showSeparator={false} />
        <SettingsStatRow
          title={loc.settings.network_sync_status}
          value={syncStatusText}
          valueColor={syncStatusColor}
          showSeparator={false}
        />
      </SettingsCard>
    </SafeAreaScrollView>
  );
};

export default NetworkSettings;

const styles = StyleSheet.create({
  content: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  sectionHeaderGap: {
    marginTop: 24,
  },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  addressBar: {
    borderRadius: 16,
    marginHorizontal: 16,
  },
  serverAddress: {
    fontSize: 16,
    fontFamily: ClashFont.regular,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowTitle: {
    fontSize: 16,
    fontFamily: ClashFont.medium,
  },
});
