import React, { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import ActionButton from './ActionButton';
import BottomModal, { BottomModalHandle } from './BottomModal';
import SuccessBadge from './SuccessBadge';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';
import loc from '../loc';

interface RestoreSuccessSheetProps {
  onDone: () => void;
  /** Set for a passphrase wallet: the only way to tell a mistyped passphrase from an empty wallet. */
  fingerprint?: string;
}

// Shown once a restored wallet has been saved, before handing off to the wallets list.
const RestoreSuccessSheet = forwardRef<BottomModalHandle, RestoreSuccessSheetProps>(({ onDone, fingerprint }, ref) => {
  const { colors } = useTheme();

  return (
    <BottomModal
      ref={ref}
      detents={['auto']}
      // Rounds the top corners only; the native sheet squares off the bottom two.
      cornerRadius={16}
      showCloseButton={false}
      isGrabberVisible={false}
      dismissible={false}
      backgroundColor={colors.background}
    >
      <View style={styles.container} testID="RestoreSuccessSheet">
        <View style={styles.icon}>
          <SuccessBadge />
        </View>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{loc.wallets.restore_success_title}</Text>
        <Text style={[styles.message, { color: colors.textMuted }]}>{loc.wallets.restore_success_message}</Text>
        {fingerprint ? (
          <Text style={[styles.message, { color: colors.textMuted }]} testID="RestoreSuccessFingerprint">
            {loc.formatString(loc.passphrase.restore_success_fingerprint, { fingerprint })}
          </Text>
        ) : null}
        <ActionButton
          title={loc.wallets.restore_success_done}
          onPress={onDone}
          backgroundColor={colors.brandPrimary}
          color={colors.white}
          style={styles.button}
          testID="RestoreSuccessDoneButton"
        />
      </View>
    </BottomModal>
  );
});

export default RestoreSuccessSheet;

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingBottom: 24 },
  icon: { marginBottom: 16 },
  title: { fontFamily: ClashFont.medium, fontSize: 20, textAlign: 'center', marginBottom: 8 },
  message: { fontFamily: ClashFont.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 24 },
  button: { width: '100%' },
});
