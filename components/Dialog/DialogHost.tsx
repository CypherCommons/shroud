import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import ActionButton from '../ActionButton';
import FieldTextInput from '../FieldTextInput';
import { useTheme } from '../themes';
import { ClashFont } from '../../constants/fonts';
import { closeCurrentDialog, DialogButton, DialogRequest, subscribeDialogs } from './dialogStore';

/**
 * Draws the app's dialogs. Mount once at the root.
 *
 * Android: a Modal is its own window, and the newest window sits above sheets and other Modals.
 * iOS: a root Modal is refused while a sheet or modal screen is presented, so the dialog goes into a
 * FullWindowOverlay instead, which attaches to the key window. It is mounted only while a dialog is
 * showing, so it lands above whatever is already open.
 */
const DialogHost: React.FC = () => {
  const [current, setCurrent] = useState<DialogRequest | null>(null);
  // Remounts the card per dialog so input text never carries over to the next one.
  const showCount = useRef(0);

  useEffect(
    () =>
      subscribeDialogs(next => {
        showCount.current += 1;
        setCurrent(next);
      }),
    [],
  );

  if (!current) return null;

  const content = <DialogCard key={showCount.current} request={current} />;

  if (Platform.OS === 'ios') {
    return <FullWindowOverlay unstable_accessibilityContainerViewIsModal>{content}</FullWindowOverlay>;
  }

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={() => dismiss(current)}>
      {content}
    </Modal>
  );
};

export default DialogHost;

const dismiss = (request: DialogRequest) => {
  if (!request.cancelable) return;
  closeCurrentDialog();
  request.onDismiss?.();
};

// Cancel goes last so the action the dialog is about sits on top, nearest the message.
const orderButtons = (buttons: DialogButton[]): DialogButton[] => [
  ...buttons.filter(b => b.style !== 'cancel'),
  ...buttons.filter(b => b.style === 'cancel'),
];

const DialogCard: React.FC<{ request: DialogRequest }> = ({ request }) => {
  const { colors } = useTheme();
  const [value, setValue] = useState('');

  const press = (button: DialogButton) => {
    closeCurrentDialog();
    button.onPress?.(request.input ? value : undefined);
  };

  const buttonColors = (style: DialogButton['style']) => {
    switch (style) {
      case 'destructive':
        return { backgroundColor: colors.surfaceCaution, color: colors.statusError, borderColor: colors.statusError };
      case 'cancel':
        return { backgroundColor: colors.fieldBackground, color: colors.textPrimary, borderColor: colors.borderDefault };
      default:
        return { backgroundColor: colors.brandPrimary, color: colors.white };
    }
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={[styles.scrim, { backgroundColor: colors.scrim }]} onPress={() => dismiss(request)} accessible={false}>
        <Pressable
          style={[styles.card, { backgroundColor: colors.background, borderColor: colors.borderDefault }]}
          accessibilityRole="alert"
          accessibilityViewIsModal
          testID="Dialog"
        >
          {request.title ? <Text style={[styles.title, { color: colors.textPrimary }]}>{request.title}</Text> : null}
          {request.message ? (
            <Text style={[request.title ? styles.message : styles.title, { color: request.title ? colors.textMuted : colors.textPrimary }]}>
              {request.message}
            </Text>
          ) : null}
          {request.input ? (
            <View style={[styles.inputBox, { backgroundColor: colors.fieldBackground, borderColor: colors.borderDefault }]}>
              <FieldTextInput
                value={value}
                onChangeText={setValue}
                secureTextEntry={request.input.secure}
                keyboardType={request.input.numeric ? 'numeric' : 'default'}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                testID="DialogInput"
              />
            </View>
          ) : null}
          <View style={styles.buttons}>
            {orderButtons(request.buttons).map((button, index) => (
              <ActionButton key={index} title={button.text} onPress={() => press(button)} {...buttonColors(button.style)} />
            ))}
          </View>
        </Pressable>
      </Pressable>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: { width: '100%', maxWidth: 400, borderRadius: 24, borderWidth: 1, padding: 24 },
  title: { fontFamily: ClashFont.medium, fontSize: 20, lineHeight: 28, textAlign: 'center' },
  message: { fontFamily: ClashFont.regular, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 8 },
  inputBox: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 4, marginTop: 16 },
  buttons: { gap: 12, marginTop: 24 },
});
