import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { Icon } from '@rneui/themed';
import { LayoutChangeEvent, ScrollView, StyleSheet, Pressable, View } from 'react-native';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import { validateMnemonic } from '../../modules/bip39';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';
import { ShroudText } from '../../ShroudComponents';
import { computeResponsiveQRSize } from '../../helpers/computeResponsiveQRSize';
import QRCard from '../../components/QRCard';
import SeedWords from '../../components/SeedWords';
import { useTheme } from '../../components/themes';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';
import useAppState from '../../hooks/useAppState';
import loc from '../../loc';
import InfoBanner from '../../components/InfoBanner';
import { WalletExportStackParamList } from '../../navigation/WalletExportStack';

type RouteProps = RouteProp<WalletExportStackParamList, 'WalletExport'>;

const HORIZONTAL_PADDING = 20;

const CopyBox: React.FC<{ text: string; onPress: () => void }> = ({ text, onPress }) => {
  const { colors } = useTheme();
  const stylesHook = StyleSheet.create({
    copyRoot: { backgroundColor: colors.borderDefault },
  });

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed, styles.copyRoot, stylesHook.copyRoot]}>
      <View style={styles.copyLeft}>
        <ShroudText textBreakStrategy="balanced" style={styles.copyText}>
          {text}
        </ShroudText>
      </View>
      <View style={styles.copyRight}>
        <Icon name="copy" type="font-awesome-5" color={colors.textSecondary} />
      </View>
    </Pressable>
  );
};

const DoNotDisclose: React.FC = () => {
  const { colors } = useTheme();

  return (
    <View style={[styles.warningBox, { backgroundColor: colors.textWarning }]}>
      <Icon type="font-awesome-5" name="exclamation-circle" color="white" />
      <ShroudText style={styles.warning}>{loc.wallets.warning_do_not_disclose}</ShroudText>
    </View>
  );
};

const WalletExport: React.FC = () => {
  const { wallets } = useStorage();
  const { walletID } = useRoute<RouteProps>().params;
  const navigation = useNavigation();
  const { isScreenCaptureAllowed } = useSettings();
  const { colors } = useTheme();
  const wallet = wallets.find(w => w.getID() === walletID)!;
  const [qrCodeSize, setQRCodeSize] = useState(90);
  const { currentAppState, previousAppState } = useAppState();
  const stylesHook = StyleSheet.create({
    root: { backgroundColor: colors.background },
  });

  const secret: string = useMemo(() => {
    try {
      const s = wallet.getSecret();
      return typeof s === 'string' ? s : '';
    } catch (error) {
      console.error('Failed to get wallet secret:', error);
      return '';
    }
  }, [wallet]);

  const secretIsMnemonic: boolean = useMemo(() => {
    return secret.length > 0 && validateMnemonic(secret);
  }, [secret]);

  const { enableScreenProtect, disableScreenProtect } = useScreenProtect();

  useEffect(() => {
    if (previousAppState === 'active' && currentAppState !== 'active') {
      const timer = setTimeout(() => navigation.goBack(), 500);
      return () => clearTimeout(timer);
    }
  }, [currentAppState, previousAppState, navigation]);

  useEffect(() => {
    if (!isScreenCaptureAllowed) {
      enableScreenProtect();
    }
    return () => {
      disableScreenProtect();
    };
  }, [isScreenCaptureAllowed, enableScreenProtect, disableScreenProtect]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { height, width } = e.nativeEvent.layout;
    const isPortrait = height > width;
    const maxQRSize = 400;

    const size = isPortrait
      ? computeResponsiveQRSize(
          { height, width },
          { heightRatio: 0.5, widthRatio: 0.75, maxSize: maxQRSize, horizontalPadding: HORIZONTAL_PADDING },
        )
      : computeResponsiveQRSize({ height, width }, { heightRatio: 0.6, widthRatio: 0.35, maxSize: maxQRSize });

    setQRCodeSize(size);
  }, []);

  const handleCopy = useCallback(() => {
    Clipboard.setString(wallet.getSecret());
    triggerHapticFeedback(HapticFeedbackTypes.Selection);
  }, [wallet]);

  if (!secret) {
    return null;
  }

  return (
    <ScrollView
      automaticallyAdjustContentInsets
      contentInsetAdjustmentBehavior="automatic"
      style={stylesHook.root}
      contentContainerStyle={styles.scrollViewContent}
      onLayout={onLayout}
      testID="WalletExportScroll"
    >
      <DoNotDisclose />

      <ShroudText style={styles.scanText}>{loc.wallets.scan_import}</ShroudText>

      <QRCard value={secret} size={qrCodeSize} isMenuAvailable={false} />

      {/* Do not allow to copy mnemonic */}
      {secretIsMnemonic ? (
        <>
          <View>
            <ShroudText style={styles.manualText}>{loc.wallets.write_down_header}</ShroudText>
            <ShroudText style={styles.writeText}>{loc.wallets.write_down}</ShroudText>
          </View>
          <SeedWords word={secret} index={0} />
          {wallet.passphraseFingerprint ? (
            <InfoBanner
              variant="caution"
              title={loc.passphrase.backup_title}
              text={loc.formatString(loc.passphrase.export_text, { fingerprint: wallet.passphraseFingerprint }) as string}
            />
          ) : null}
        </>
      ) : (
        <>
          <ShroudText style={styles.writeText}>{loc.wallets.copy_ln_public}</ShroudText>
          <CopyBox text={secret} onPress={handleCopy} />
        </>
      )}

      <ShroudText style={styles.typeText}>
        {loc.formatString(loc.wallets.wallet_type_this, {
          type: wallet.typeReadable,
        })}
      </ShroudText>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollViewContent: {
    justifyContent: 'center',
    flexGrow: 1,
    gap: 32,
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 10,
    paddingBottom: 20,
  },
  warningBox: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 8,
  },
  warning: {
    fontSize: 20,
    color: 'white',
  },
  scanText: {
    textAlign: 'center',
    fontSize: 20,
  },
  writeText: {
    textAlign: 'center',
    fontSize: 17,
  },
  manualText: {
    textAlign: 'center',
    fontSize: 20,
    marginBottom: 10,
  },
  typeText: {
    textAlign: 'center',
    fontSize: 17,
    color: 'grey',
  },
  copyRoot: {
    padding: 10,
    borderRadius: 8,
    flexDirection: 'row',
  },
  copyLeft: {
    flexShrink: 1,
  },
  copyRight: {
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  copyText: {
    fontSize: 17,
  },
  pressed: {
    opacity: 0.6,
  },
});

export default WalletExport;
