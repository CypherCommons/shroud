import React, { useCallback } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import SettingsCard from '../../components/SettingsCard';
import SettingsRowWrapper from '../../components/SettingsRowWrapper';
import CheckmarkIcon from '../../components/icons/CheckmarkIcon';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import presentAlert from '../../components/Alert';
import confirm from '../../helpers/confirm';
import loc from '../../loc';
import { ClashFont } from '../../constants/fonts';
import { getEnabledNetworks, type NetworkId } from '../../modules/network';

/**
 * Which chain the wallet is on: mainnet, testnet4 or signet. Not to be confused with
 * `NetworkSettings`, which is about connectivity (Electrum server, Tor, explorer) on whichever
 * chain is selected here.
 */
const BitcoinNetworkSettings: React.FC = () => {
  const { colors } = useTheme();
  const { activeNetworkId, switchNetwork, isSwitchingNetwork, scanState } = useStorage();
  const networks = getEnabledNetworks();

  const onSelect = useCallback(
    async (next: NetworkId) => {
      if (next === activeNetworkId || isSwitchingNetwork) return;

      // A scan can take a long time; abandoning one silently would look like the app lost data.
      if (scanState.status === 'scanning') {
        const proceed = await confirm(loc.settings.network_switch_scan_title, loc.settings.network_switch_scan_message);
        if (!proceed) return;
      }

      try {
        await switchNetwork(next);
      } catch (error: any) {
        presentAlert({ title: loc.errors.error, message: error?.message ?? String(error) });
      }
    },
    [activeNetworkId, isSwitchingNetwork, switchNetwork, scanState.status],
  );

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content} testID="BitcoinNetworkSettingsScrollView">
      <SettingsCard>
        {networks.map((network, index) => {
          const selected = network.id === activeNetworkId;
          // A chain with no indexer cannot be scanned; the subtitle says why.
          const unavailable = isSwitchingNetwork || !network.indexerBaseUrl;
          return (
            <SettingsRowWrapper key={network.id} showSeparator={index < networks.length - 1}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: unavailable }}
                accessibilityLabel={network.displayName}
                disabled={unavailable}
                onPress={() => onSelect(network.id)}
                style={({ pressed }) => [styles.row, pressed && Platform.OS !== 'android' && styles.rowPressed]}
                android_ripple={{ color: colors.borderDefault }}
                testID={`NetworkOption-${network.id}`}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{network.displayName}</Text>
                  {!network.indexerBaseUrl && (
                    <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>{loc.settings.network_no_indexer}</Text>
                  )}
                </View>
                {selected && <CheckmarkIcon color={colors.brandPrimary} size={20} />}
              </Pressable>
            </SettingsRowWrapper>
          );
        })}
      </SettingsCard>

      {isSwitchingNetwork && (
        <View style={styles.switchingRow}>
          <ActivityIndicator color={colors.brandPrimary} />
          <Text style={[styles.switchingText, { color: colors.textMuted }]}>{loc.settings.network_switching}</Text>
        </View>
      )}

      <SettingsCard style={styles.descriptionCard}>
        <Text style={[styles.descriptionText, { color: colors.textMuted }]}>{loc.settings.network_description}</Text>
      </SettingsCard>
    </SafeAreaScrollView>
  );
};

export default BitcoinNetworkSettings;

const styles = StyleSheet.create({
  content: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowText: {
    flex: 1,
    paddingRight: 12,
  },
  rowTitle: {
    fontSize: 16,
    fontFamily: ClashFont.medium,
  },
  rowSubtitle: {
    fontSize: 13,
    fontFamily: ClashFont.regular,
    marginTop: 2,
  },
  switchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  switchingText: {
    fontSize: 14,
    fontFamily: ClashFont.regular,
    marginLeft: 8,
  },
  descriptionCard: {
    marginTop: 16,
    padding: 16,
  },
  descriptionText: {
    fontSize: 14,
    fontFamily: ClashFont.regular,
    lineHeight: 23,
  },
});
