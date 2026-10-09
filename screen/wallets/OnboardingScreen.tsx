import React, { useCallback, useMemo, useRef } from 'react';
import { ActivityIndicator, View, Text, StyleSheet, Image } from 'react-native';
import { useTheme } from '../../components/themes';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { TWallet } from '../../class/wallets/types';
import { ClashFont } from '../../constants/fonts';
import loc from '../../loc';
import presentAlert from '../../components/Alert';
import { useStorage } from '../../hooks/context/useStorage';
import { useSelectNetwork } from '../../hooks/useSelectNetwork';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';
import { getDefaultIndexer } from '../../modules/SilentPaymentIndexer';
import { getEnabledNetworks, getNetwork, isNetworkId } from '../../modules/network';
import { isNetworkSwitchable } from '../../modules/networkPreference';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/Button';
import ToolTipMenu from '../../components/TooltipMenu';
import ChevronDownIcon from '../../components/icons/ChevronDownIcon';

type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'Onboarding'>;

/** Where a new wallet's scan starts: now, or the beginning of the chain's silent-payment history. */
type ScanFrom = 'now' | 'beginning';

/** For a wallet whose phrase has never been paid on this chain: no history to scan for. */
async function startScanningFromNow(w: TWallet): Promise<void> {
  try {
    const indexer = getDefaultIndexer();
    const latestHeightResponse = await indexer.getLatestBlockHeight();
    w.setBirthHeight(latestHeightResponse.height);
    console.log(`Wallet birth height set to: ${latestHeightResponse.height}`);
  } catch (error) {
    // indexer unreachable (or not initialised) at creation: remember when the wallet was made so
    // the first scan that reaches it resolves the height, instead of rescanning from BIP-352 activation.
    console.warn('Could not fetch birth height, deferring resolution to the first scan:', error);
    w.updateBirthHeight(w.getNetworkConfig().bip352ActivationHeight, { pendingTimestamp: Math.floor(Date.now() / 1000) });
  }
}

const OnboardingScreen: React.FC = () => {
  const { colors } = useTheme();
  const { navigate, navigateToWalletsList } = useExtendedNavigation<NavigationProps>();
  const {
    addWallet,
    deleteWallet,
    saveToDisk,
    wallets,
    activeNetworkId,
    isSwitchingNetwork,
    walletToReuse,
    setPendingWallet,
    getPendingWallet,
  } = useStorage();
  const selectNetwork = useSelectNetwork();
  const networkName = getNetwork(activeNetworkId).displayName;

  /**
   * Add a wallet made on this screen, date its scan and save it. Resolves false when it couldn't be
   * added or saved; a failed save takes it back out, so no wallet is shown that a restart would lose.
   */
  const addNewWallet = useCallback(
    async (w: TWallet, scanFrom: ScanFrom): Promise<boolean> => {
      if (!addWallet(w)) {
        presentAlert({ message: loc.wallets.single_wallet_limit });
        return false;
      }
      try {
        if (scanFrom === 'now') {
          await startScanningFromNow(w);
        } else {
          w.updateBirthHeight(w.getNetworkConfig().bip352ActivationHeight);
        }
        await saveToDisk();
      } catch (error: any) {
        deleteWallet(w);
        presentAlert({
          title: loc.errors.error,
          message: error?.message ?? String(error),
          hapticFeedback: HapticFeedbackTypes.NotificationError,
        });
        return false;
      }
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      return true;
    },
    [addWallet, deleteWallet, saveToDisk],
  );

  // Creating awaits the indexer, so a second tap would otherwise make a second pending wallet after
  // the backup screen already shows the first one's words.
  const isCreatingRef = useRef(false);

  const handleContinue = useCallback(async () => {
    if (isSwitchingNetwork) return;
    if (wallets.length > 0) {
      navigateToWalletsList();
      return;
    }
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;

    try {
      // Creation left unfinished (e.g. the app was killed during backup): same words again.
      if (getPendingWallet()) {
        navigate('AddWalletRoot', { screen: 'PleaseBackup' });
        return;
      }

      const w = new HDSilentPaymentsWallet();
      w.setLabel(loc.wallets.details_title);
      await w.generate();
      await startScanningFromNow(w);
      // Saved as a draft before its words are shown; it becomes a real wallet once the backup is done
      // (or skipped), so a passphrase can still be chosen there.
      await setPendingWallet(w);

      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);

      navigate('AddWalletRoot', { screen: 'PleaseBackup' });
    } finally {
      isCreatingRef.current = false;
    }
  }, [isSwitchingNetwork, wallets, navigateToWalletsList, getPendingWallet, setPendingWallet, navigate]);

  const reuseRecoveryPhrase = useCallback(
    async (source: TWallet, scanFrom: ScanFrom) => {
      if (wallets.length > 0) {
        navigateToWalletsList();
        return;
      }

      const w = HDSilentPaymentsWallet.fromMnemonic(source.getSecret(), source.getPassphrase());
      w.setLabel(source.getLabel());
      // One phrase: backed up for the other chain means backed up for this one too.
      w.setUserHasSavedExport(source.getUserHasSavedExport());
      if (await addNewWallet(w, scanFrom)) navigateToWalletsList();
    },
    [wallets, navigateToWalletsList, addNewWallet],
  );

  const onReusePress = useCallback(() => {
    if (isSwitchingNetwork || !walletToReuse) return;
    const source = walletToReuse;
    presentAlert({
      title: loc.formatString(loc.onboarding.reuse_phrase_title, { from: getNetwork(source.networkId).displayName }),
      message: loc.formatString(loc.onboarding.reuse_phrase_message, { to: networkName }),
      buttons: [
        { text: loc.onboarding.reuse_phrase_start_now, onPress: () => reuseRecoveryPhrase(source, 'now') },
        { text: loc.onboarding.reuse_phrase_scan_history, onPress: () => reuseRecoveryPhrase(source, 'beginning') },
        { text: loc._.cancel, style: 'cancel' },
      ],
      options: { cancelable: true },
    });
  }, [isSwitchingNetwork, walletToReuse, networkName, reuseRecoveryPhrase]);

  const importWallet = useCallback(() => {
    if (isSwitchingNetwork) return;
    if (wallets.length > 0) {
      navigateToWalletsList();
      return;
    }
    navigate('AddWalletRoot', { screen: 'ImportWallet' });
  }, [isSwitchingNetwork, wallets, navigateToWalletsList, navigate]);

  const networkActions = useMemo(
    () =>
      getEnabledNetworks().map(network => {
        // Only enabled chains are listed, so one that can't be switched to has no indexer to scan it.
        const switchable = isNetworkSwitchable(network.id);
        return {
          id: network.id,
          text: network.displayName,
          menuState: network.id === activeNetworkId,
          disabled: !switchable,
          subtitle: switchable ? undefined : loc.settings.network_no_indexer,
        };
      }),
    [activeNetworkId],
  );

  const onPressNetwork = useCallback(
    (id: string) => {
      if (isNetworkId(id)) selectNetwork(id);
    },
    [selectNetwork],
  );

  return (
    <SafeAreaView style={[styles.welcomeContainer, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Image source={require('../../img/icon.png')} style={styles.logo} resizeMode="contain" />
        <Text style={[styles.title, { color: colors.brandPrimary }]}>{loc.onboarding.shroud}</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{loc.onboarding.subtitle}</Text>
        {networkActions.length > 1 && (
          <ToolTipMenu
            isButton
            isMenuPrimaryAction
            title={loc.settings.bitcoin_network}
            actions={networkActions}
            onPressMenuItem={onPressNetwork}
            buttonStyle={[styles.networkButton, { backgroundColor: colors.surfaceSubtle, borderColor: colors.accentSubtle }]}
            accessibilityRole="button"
            accessibilityLabel={`${loc.settings.bitcoin_network}: ${networkName}`}
            testID="OnboardingNetworkButton"
          >
            <Text style={[styles.networkButtonText, { color: colors.textBrand }]}>{networkName}</Text>
            {isSwitchingNetwork ? (
              <ActivityIndicator size="small" color={colors.brandPrimary} />
            ) : (
              <ChevronDownIcon size={16} color={colors.brandPrimary} />
            )}
          </ToolTipMenu>
        )}
      </View>

      <View style={styles.buttonContainer}>
        <Button
          title={loc.onboarding.create_wallet}
          onPress={handleContinue}
          testID="CreateWallet"
          borderRadius={16}
          backgroundColor={colors.brandPrimary}
          style={styles.button}
        />
        {walletToReuse && (
          <Button
            title={loc.formatString(loc.onboarding.reuse_phrase, { from: getNetwork(walletToReuse.networkId).displayName })}
            onPress={onReusePress}
            testID="ReuseRecoveryPhrase"
            borderRadius={16}
            backgroundColor="transparent"
            buttonTextColor={colors.textBrand}
            style={[styles.button, styles.secondaryButton, { borderColor: colors.accentSubtle }]}
          />
        )}
        <Button
          title={loc.onboarding.import_wallet}
          onPress={importWallet}
          testID="ImportWallet"
          borderRadius={16}
          backgroundColor="transparent"
          buttonTextColor={colors.textBrand}
          style={[styles.button, styles.secondaryButton, { borderColor: colors.accentSubtle }]}
        />
      </View>
    </SafeAreaView>
  );
};

export default OnboardingScreen;

const styles = StyleSheet.create({
  welcomeContainer: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  logo: { width: 88, height: 88, marginBottom: 24 },
  title: { fontFamily: ClashFont.semibold, fontSize: 37, textAlign: 'center', textTransform: 'uppercase', marginBottom: 16 },
  subtitle: { fontFamily: ClashFont.regular, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  networkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    marginTop: 24,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  networkButtonText: { fontFamily: ClashFont.medium, fontSize: 14 },
  buttonContainer: { paddingHorizontal: 24, paddingBottom: 24, gap: 12 },
  button: { height: 56, maxHeight: 56 },
  secondaryButton: { borderWidth: 1 },
});
