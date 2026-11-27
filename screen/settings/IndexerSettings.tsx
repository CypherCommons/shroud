import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import SettingsSectionHeader from '../../components/SettingsSectionHeader';
import SettingsTextInput from '../../components/SettingsTextInput';
import SettingsCard from '../../components/SettingsCard';
import InfoBanner from '../../components/InfoBanner';
import { ClashFont } from '../../constants/fonts';
import Button from '../../components/Button';
import presentAlert from '../../components/Alert';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { getActiveNetworkId, getNetwork, type NetworkId } from '../../modules/network';
import { getIndexerConfig, getIndexerPreference, normalizeIndexerUrl, saveIndexerPreference } from '../../modules/indexerPreference';
import { getDefaultIndexer, SilentPaymentIndexer } from '../../modules/SilentPaymentIndexer';
import loc from '../../loc';

const IndexerSettings = () => {
  const { activeNetworkId } = useStorage();
  return <IndexerSettingsForm key={activeNetworkId} activeNetworkId={activeNetworkId} />;
};

const IndexerSettingsForm = ({ activeNetworkId }: { activeNetworkId: NetworkId }) => {
  const { colors } = useTheme();
  const saved = getIndexerPreference(activeNetworkId);
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? '');
  const [onionUrl, setOnionUrl] = useState(saved?.onionUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [activeUrl, setActiveUrl] = useState(() => getDefaultIndexer().getBaseUrl());
  const [usingFallback, setUsingFallback] = useState(() => getDefaultIndexer().isUsingFallback());

  useEffect(() => {
    const update = () => {
      const indexer = getDefaultIndexer();
      setActiveUrl(indexer.getBaseUrl());
      setUsingFallback(indexer.isUsingFallback());
    };
    const timer = setInterval(update, 2000);
    return () => clearInterval(timer);
  }, [activeNetworkId]);

  const save = async (reset = false) => {
    setBusy(true);
    try {
      let preference;
      if (!reset) {
        try {
          preference = {
            baseUrl: normalizeIndexerUrl(baseUrl),
            onionUrl: onionUrl.trim() ? normalizeIndexerUrl(onionUrl, true) : undefined,
          };
        } catch {
          throw new Error(loc.settings.indexer_invalid_url);
        }
        // No fallback on a connection test: it must check the endpoint the user entered.
        const candidate = new SilentPaymentIndexer({
          ...preference,
          timeout: 8000,
        });
        try {
          await candidate.getHealth();
          await candidate.getLatestBlockHeight();
        } catch {
          throw new Error(loc.settings.indexer_test_failed);
        }
      }
      if (getActiveNetworkId() !== activeNetworkId) throw new Error(loc.settings.indexer_network_changed);
      await saveIndexerPreference(activeNetworkId, preference);
      if (getActiveNetworkId() !== activeNetworkId) return;
      // Update the existing object: running scans pick it up at their next request boundary.
      // Any already-downloaded batch still belongs to this same Bitcoin network.
      const indexer = getDefaultIndexer();
      indexer.configure(getIndexerConfig(activeNetworkId));
      setActiveUrl(indexer.getBaseUrl());
      setUsingFallback(false);
      if (reset) {
        setBaseUrl('');
        setOnionUrl('');
      }
      presentAlert({ message: loc.settings.indexer_saved });
    } catch (error) {
      presentAlert({
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="always" testID="IndexerSettingsScrollView">
      <Text style={[styles.description, { color: colors.textSecondary }]}>
        {loc.formatString(loc.settings.indexer_description, getNetwork(activeNetworkId).displayName)}
      </Text>

      <SettingsSectionHeader style={styles.sectionHeaderGap}>{loc.settings.indexer_active}</SettingsSectionHeader>
      <SettingsCard>
        <Text selectable style={[styles.currentUrl, { color: colors.textPrimary }]}>
          {activeUrl}
        </Text>
      </SettingsCard>
      {usingFallback && <InfoBanner variant="caution" text={loc.settings.indexer_fallback_active} containerStyle={styles.noticeGap} />}

      <SettingsSectionHeader style={styles.sectionHeaderGap}>{loc.settings.indexer_url}</SettingsSectionHeader>
      <SettingsCard>
        <View style={styles.formContent}>
          <SettingsTextInput
            value={baseUrl}
            onChangeText={setBaseUrl}
            editable={!busy}
            keyboardType="url"
            placeholder="https://indexer.example.com"
            testID="IndexerUrlInput"
          />
          <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>{loc.settings.indexer_onion_url}</Text>
          <SettingsTextInput
            value={onionUrl}
            onChangeText={setOnionUrl}
            editable={!busy}
            keyboardType="url"
            placeholder="http://….onion"
            testID="IndexerOnionInput"
          />
          <Button
            title={loc.settings.indexer_test_save}
            onPress={() => save()}
            disabled={busy || !baseUrl.trim()}
            showActivityIndicator={busy}
            style={styles.saveButton}
            testID="SaveIndexerButton"
          />
        </View>
      </SettingsCard>

      <SettingsCard style={styles.descriptionCard}>
        <Text style={[styles.description, { color: colors.textMuted }]}>{loc.settings.indexer_fallback_description}</Text>
      </SettingsCard>
      <Button
        title={loc.settings.indexer_reset}
        onPress={() => save(true)}
        disabled={busy}
        backgroundColor={colors.fieldBackground}
        buttonTextColor={colors.textPrimary}
        style={styles.resetButton}
        testID="ResetIndexerButton"
      />
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  description: {
    fontSize: 14,
    fontFamily: ClashFont.regular,
    lineHeight: 23,
  },
  sectionHeaderGap: {
    marginTop: 24,
  },
  currentUrl: {
    padding: 16,
    fontSize: 16,
    fontFamily: ClashFont.regular,
    lineHeight: 24,
  },
  formContent: {
    padding: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontFamily: ClashFont.medium,
    lineHeight: 20,
    marginTop: 16,
    marginBottom: 8,
  },
  saveButton: {
    marginTop: 16,
  },
  descriptionCard: {
    marginTop: 16,
    padding: 16,
  },
  noticeGap: {
    marginTop: 16,
  },
  resetButton: {
    marginTop: 16,
  },
});

export default IndexerSettings;
