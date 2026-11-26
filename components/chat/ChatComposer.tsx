import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ClashFont } from '../../constants/fonts';
import loc from '../../loc';
import PaperPlaneIcon from '../icons/PaperPlaneIcon';
import { useTheme } from '../themes';

const MIN_HEIGHT = 44;
const MAX_HEIGHT = 120;

interface ChatComposerProps {
  /** Returns false when the send failed, so the typed text can be put back. */
  onSend: (text: string) => Promise<boolean>;
  /** Omitted for a conversation with someone who isn't a contact: there is no address to pay. */
  onPay?: () => void;
  onRequest?: () => void;
  disabled?: boolean;
}

/** Text field with Send, plus the Pay and Request shortcuts that make this a payments chat. */
const ChatComposer: React.FC<ChatComposerProps> = ({ onSend, onPay, onRequest, disabled }) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [height, setHeight] = useState(MIN_HEIGHT);
  // A no-op style flip after clearing: Fabric on iOS sizes a TextInput from its previous text when
  // `value` is set in code, and a second layout pass corrects it.
  const [nudge, setNudge] = useState(false);

  const canSend = !disabled && text.trim().length > 0;

  const submit = useCallback(async () => {
    const value = text.trim();
    if (!value || disabled) return;
    setText('');
    setHeight(MIN_HEIGHT);
    setNudge(n => !n);
    const ok = await onSend(value);
    if (!ok) setText(value);
  }, [text, disabled, onSend]);

  return (
    <View
      style={[
        styles.root,
        { borderTopColor: colors.borderDefault, backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 12) },
      ]}
    >
      {(onPay || onRequest) && (
        <View style={styles.shortcuts}>
          {onPay && (
            <Pressable
              accessibilityRole="button"
              onPress={onPay}
              style={[styles.chip, { backgroundColor: colors.brandPrimary }]}
              testID="ChatPayButton"
            >
              <PaperPlaneIcon size={16} color={colors.white} />
              <Text style={[styles.chipText, { color: colors.white }]}>{loc.chat.pay}</Text>
            </Pressable>
          )}
          {onRequest && (
            <Pressable
              accessibilityRole="button"
              onPress={onRequest}
              style={[styles.chip, { backgroundColor: colors.surfaceSubtle }]}
              testID="ChatRequestButton"
            >
              <Text style={[styles.chipText, { color: colors.textBrand }]}>{loc.chat.request}</Text>
            </Pressable>
          )}
        </View>
      )}
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          onContentSizeChange={e => setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, e.nativeEvent.contentSize.height + 20)))}
          placeholder={loc.chat.composer_placeholder}
          placeholderTextColor={colors.textMuted}
          editable={!disabled}
          multiline
          maxLength={4000}
          style={[
            styles.input,
            { height, backgroundColor: colors.fieldBackground, color: colors.textPrimary },
            nudge ? styles.nudgeOn : styles.nudgeOff,
          ]}
          testID="ChatComposerInput"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={loc.chat.send}
          disabled={!canSend}
          onPress={submit}
          style={[styles.send, { backgroundColor: canSend ? colors.brandPrimary : colors.ctaDisabled }]}
          testID="ChatSendButton"
        >
          <PaperPlaneIcon size={20} color={colors.white} />
        </Pressable>
      </View>
    </View>
  );
};

export default ChatComposer;

const styles = StyleSheet.create({
  root: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 10, gap: 10 },
  shortcuts: { flexDirection: 'row', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 17 },
  chipText: { fontFamily: ClashFont.medium, fontSize: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: MIN_HEIGHT,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    fontFamily: ClashFont.regular,
    fontSize: 16,
  },
  nudgeOn: { marginTop: 0.01 },
  nudgeOff: { marginTop: 0 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
