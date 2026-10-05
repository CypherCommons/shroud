import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useTheme } from '../../components/themes';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { ClashFont } from '../../constants/fonts';
import loc from '../../loc';
import presentAlert from '../../components/Alert';
import { useStorage } from '../../hooks/context/useStorage';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';
import { getDefaultIndexer } from '../../modules/SilentPaymentIndexer';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/Button';

type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'Onboarding'>;

const OnboardingScreen: React.FC = () => {
  const { colors } = useTheme();
  const { navigate, navigateToWalletsList } = useExtendedNavigation<NavigationProps>();
  const { addWallet, saveToDisk, wallets } = useStorage();

  const handleContinue = useCallback(async () => {
    if (wallets.length > 0) {
      navigateToWalletsList();
      return;
    }

    const w = new HDSilentPaymentsWallet();
    w.setLabel(loc.wallets.details_title);
    await w.generate();
    if (!addWallet(w)) {
      presentAlert({ message: loc.wallets.single_wallet_limit });
      return;
    }
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
    await saveToDisk();

    triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);

    navigate('AddWalletRoot', {
      screen: 'PleaseBackup',
      params: {
        walletID: w.getID(),
      },
    });
  }, [wallets, navigateToWalletsList, addWallet, saveToDisk, navigate]);

  const importWallet = useCallback(() => {
    if (wallets.length > 0) {
      navigateToWalletsList();
      return;
    }
    navigate('AddWalletRoot', { screen: 'ImportWallet' });
  }, [wallets, navigateToWalletsList, navigate]);

  const renderCoverScreen = useCallback(() => {
    return (
      <SafeAreaView style={[styles.welcomeContainer, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <Image source={require('../../img/icon.png')} style={styles.logo} resizeMode="contain" />
          <Text style={[styles.title, { color: colors.brandPrimary }]}>{loc.onboarding.shroud}</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>{loc.onboarding.subtitle}</Text>
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
  }, [colors, handleContinue, importWallet]);

  return renderCoverScreen();
};

export default OnboardingScreen;

const styles = StyleSheet.create({
  welcomeContainer: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  logo: { width: 88, height: 88, marginBottom: 24 },
  title: { fontFamily: ClashFont.semibold, fontSize: 37, textAlign: 'center', textTransform: 'uppercase', marginBottom: 16 },
  subtitle: { fontFamily: ClashFont.regular, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  buttonContainer: { paddingHorizontal: 24, paddingBottom: 24, gap: 12 },
  button: { height: 56, maxHeight: 56 },
  secondaryButton: { borderWidth: 1 },
});
