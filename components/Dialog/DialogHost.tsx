import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { FullWindowOverlay } from 'react-native-screens';
import ActionButton from '../ActionButton';
import FieldTextInput from '../FieldTextInput';
import { useTheme } from '../themes';
import { ClashFont } from '../../constants/fonts';
import { closeDialog, DialogButton, DialogRequest, subscribeDialogs } from './dialogStore';

/**
 * Draws the app's dialogs. Mount once at the root.
 *
 * Android: a Modal is its own window, and the newest window sits above sheets and other Modals.
 * iOS: a root Modal is refused while a sheet or modal screen is presented, so the dialog goes into a
 * FullWindowOverlay instead, which attaches to the key window. It is mounted only while a dialog is
 * showing, so it lands above whatever is already open.
 */
const DialogHost: React.FC = () => {
  // `key` remounts the card per dialog so input text never carries over to the next one.
  const [current, setCurrent] = useState<{ request: DialogRequest; key: number } | null>(null);
  const showCount = useRef(0);

  useEffect(
    () =>
      subscribeDialogs(next => {
        showCount.current += 1;
        setCurrent(next ? { request: next, key: showCount.current } : null);
      }),
    [],
  );

  if (!current) return null;

  const content = <DialogCard key={current.key} request={current.request} />;

  if (Platform.OS === 'ios') {
    return <FullWindowOverlay unstable_accessibilityContainerViewIsModal>{content}</FullWindowOverlay>;
  }

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={() => dismiss(current.request)}>
      {content}
    </Modal>
  );
};

export default DialogHost;

const dismiss = (request: DialogRequest) => {
  if (!request.cancelable || !closeDialog(request)) return;
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
    if (!closeDialog(request)) return;
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
    <KeyboardAvoidingView style={styles.fill} behavior="padding">
      <Pressable
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={() => dismiss(request)}
        accessible={false}
        testID="DialogScrim"
      >
        <Pressable
          style={[styles.card, { backgroundColor: colors.background, borderColor: colors.borderDefault }]}
          // Not one element, or VoiceOver can't reach the buttons inside.
          accessible={false}
          accessibilityViewIsModal
          testID="Dialog"
        >
          {/* A long message or a large font scrolls here, so the buttons below always stay on screen. */}
          <ScrollView style={styles.text} bounces={false}>
            {request.title ? <Text style={[styles.title, { color: colors.textPrimary }]}>{request.title}</Text> : null}
            {request.message ? (
              <Text
                style={[
                  request.title ? styles.message : styles.title,
                  { color: request.title ? colors.textSecondary : colors.textPrimary },
                ]}
              >
                {request.message}
              </Text>
            ) : null}
          </ScrollView>
          {request.input ? (
            <View style={[styles.inputBox, { backgroundColor: colors.fieldBackground, borderColor: colors.borderDefault }]}>
              <FieldTextInput
                value={value}
                onChangeText={setValue}
                secureTextEntry={request.input.secure}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => {
                  const confirm = request.buttons.find(b => b.style !== 'cancel');
                  if (confirm) press(confirm);
                }}
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
  card: { width: '100%', maxWidth: 400, maxHeight: '80%', borderRadius: 24, borderWidth: 1, padding: 24 },
  text: { flexGrow: 0, flexShrink: 1 },
  title: { fontFamily: ClashFont.medium, fontSize: 20, lineHeight: 28, textAlign: 'center' },
  message: { fontFamily: ClashFont.regular, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 8 },
  inputBox: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 4, marginTop: 16 },
  buttons: { gap: 12, marginTop: 24 },
});
