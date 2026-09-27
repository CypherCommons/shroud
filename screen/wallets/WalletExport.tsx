import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import dayjs from 'dayjs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import LabeledField from '../../components/LabeledField';
import FieldTextInput from '../../components/FieldTextInput';
import Checkbox from '../../components/Checkbox';
import InfoBanner from '../../components/InfoBanner';
import ActionButton from '../../components/ActionButton';
import presentAlert from '../../components/Alert';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { writeFileAndExport } from '../../modules/fs';
import { ClashFont } from '../../constants/fonts';
import loc from '../../loc';

const MIN_PASSWORD_LENGTH = 8;

const WalletExport: React.FC = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { exportEncryptedBackup } = useStorage();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const canSubmit = useMemo(
    () => password.length >= MIN_PASSWORD_LENGTH && password === confirmPassword && isConfirmed && !isCreating,
    [password, confirmPassword, isConfirmed, isCreating],
  );

  const handleCreateBackup = async () => {
    if (!canSubmit) return;
    setIsCreating(true);
    try {
      const encrypted = await exportEncryptedBackup(password);
      const fileName = `Shroud-Export-${dayjs().format('YYYY-MM-DD')}.backup`;
      await writeFileAndExport(fileName, encrypted);
    } catch (error) {
      console.error('backup export failed:', error);
      presentAlert({ message: loc.wallets.export_backup_error });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content} testID="WalletExportScrollView">
      <Text style={[styles.description, { color: colors.textMuted }]}>{loc.wallets.export_backup_description}</Text>

      <LabeledField
        label={loc.wallets.export_backup_password_label}
        trailing={
          <Pressable onPress={() => setIsPasswordVisible(v => !v)} hitSlop={8} testID="TogglePasswordVisibility">
            <Text style={[styles.toggleText, { color: colors.primary }]}>
              {isPasswordVisible ? loc.wallets.export_backup_hide : loc.wallets.export_backup_show}
            </Text>
          </Pressable>
        }
      >
        <FieldTextInput
          testID="BackupPasswordInput"
          secureTextEntry={!isPasswordVisible}
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
      </LabeledField>
      <Text style={[styles.fieldHint, { color: colors.textMuted }]}>
        {loc.formatString(loc.wallets.export_backup_password_hint, { count: MIN_PASSWORD_LENGTH })}
      </Text>

      <View style={styles.fieldGap} />

      <LabeledField label={loc.wallets.export_backup_confirm_label}>
        <FieldTextInput
          testID="BackupConfirmPasswordInput"
          secureTextEntry={!isPasswordVisible}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
      </LabeledField>
      {passwordsMismatch && <InfoBanner variant="error" text={loc.wallets.export_backup_mismatch} containerStyle={styles.mismatchBanner} />}

      <Pressable style={styles.checkboxRow} onPress={() => setIsConfirmed(c => !c)} testID="ConfirmPasswordUnderstoodRow">
        <Checkbox value={isConfirmed} onValueChange={setIsConfirmed} accessibilityLabel={loc.wallets.export_backup_checkbox} />
        <Text style={[styles.checkboxText, { color: colors.textPrimary }]}>{loc.wallets.export_backup_checkbox}</Text>
      </Pressable>

      <View style={styles.spacer} />

      <InfoBanner
        variant="caution"
        text={loc.wallets.export_backup_warning}
        emphasis={loc.wallets.export_backup_warning_emphasis}
        containerStyle={styles.banner}
      />

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        <ActionButton
          title={loc.wallets.export_backup_button}
          onPress={handleCreateBackup}
          disabled={!canSubmit}
          backgroundColor={canSubmit ? colors.brandPrimary : colors.ctaDisabled}
          color={colors.white}
          testID="CreateBackupFileButton"
        />
      </View>
    </SafeAreaScrollView>
  );
};

export default WalletExport;

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  description: {
    fontFamily: ClashFont.regular,
    fontSize: 15,
    lineHeight: 22.5,
    marginBottom: 24,
  },
  fieldGap: {
    height: 16,
  },
  fieldHint: {
    fontFamily: ClashFont.regular,
    fontSize: 13,
    marginTop: 6,
  },
  mismatchBanner: {
    marginTop: 12,
  },
  toggleText: {
    fontFamily: ClashFont.medium,
    fontSize: 14,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 20,
  },
  checkboxText: {
    flex: 1,
    fontFamily: ClashFont.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  spacer: {
    flex: 1,
    minHeight: 24,
  },
  banner: {
    marginBottom: 20,
  },
  footer: {
    paddingTop: 8,
  },
});
