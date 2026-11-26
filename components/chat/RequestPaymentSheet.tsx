import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ClashFont } from '../../constants/fonts';
import loc from '../../loc';
import ActionButton from '../ActionButton';
import { useTheme } from '../themes';

const MAX_SATS = 21_000_000 * 100_000_000;

interface RequestPaymentSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (request: { amount: number; note?: string }) => void;
}

/** Asks for an amount in sats and an optional note, for a payment request. */
const RequestPaymentSheet: React.FC<RequestPaymentSheetProps> = ({ visible, onClose, onSubmit }) => {
  const { colors } = useTheme();
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');

  // Cleared on the way out, so the next request starts empty.
  const close = () => {
    setAmountText('');
    setNote('');
    onClose();
  };
  const submit = () => {
    const request = { amount, note: note.trim() || undefined };
    setAmountText('');
    setNote('');
    onSubmit(request);
  };

  const amount = /^\d+$/.test(amountText) ? Number(amountText) : 0;
  const valid = Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_SATS;

  const inputStyle = [styles.input, { backgroundColor: colors.fieldBackground, color: colors.textPrimary }];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={[styles.overlay, { backgroundColor: colors.scrim }]}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel={loc._.cancel} />
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{loc.chat.request_prompt_title}</Text>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            placeholder={loc.chat.request_prompt_placeholder}
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            style={inputStyle}
            testID="RequestAmountInput"
          />
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={loc.chat.request_prompt_note}
            placeholderTextColor={colors.textMuted}
            maxLength={200}
            style={inputStyle}
            testID="RequestNoteInput"
          />
          <ActionButton
            title={loc.chat.request_prompt_send}
            onPress={submit}
            disabled={!valid}
            backgroundColor={colors.brandPrimary}
            color={colors.white}
            testID="RequestSubmitButton"
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default RequestPaymentSheet;

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  title: { fontFamily: ClashFont.medium, fontSize: 20 },
  input: { height: 52, borderRadius: 16, paddingHorizontal: 16, fontFamily: ClashFont.regular, fontSize: 16 },
});
