import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';
import LottieView from 'lottie-react-native';
import ActionButton from '../../components/ActionButton';
import AmountHero from '../../components/AmountHero';
import CheckmarkIcon from '../../components/icons/CheckmarkIcon';
import { ClashFont } from '../../constants/fonts';
import { useTheme } from '../../components/themes';
import loc from '../../loc';
import ContactChip from '../../components/ContactChip';
import SaveContactRow from '../../components/SaveContactRow';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList.ts';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation.ts';
import { btcToSatoshi, satoshiToLocalCurrency } from '../../modules/currency';
import { useContacts } from '../../hooks/context/useContacts';

type RouteProps = RouteProp<SendDetailsStackParamList, 'Success'>;

const Success = () => {
  const navigation = useExtendedNavigation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProps>();
  const { amount, recipientAddress } = route.params || {};
  const { getContact } = useContacts();

  const amountStr = amount != null ? String(amount) : '0';
  const amountSats = amount != null ? btcToSatoshi(amount) : 0;
  const fiat = `≈ ${satoshiToLocalCurrency(amountSats)}`;

  // Whoever was paid, named: a known payee straight away, an unsaved one once the row takes a name.
  const contact = recipientAddress === undefined ? undefined : getContact(recipientAddress);

  const onDonePressed = () => {
    // @ts-ignore getParent() typing doesn't expose pop()
    navigation?.getParent()?.pop();
  };

  const stylesHook = StyleSheet.create({
    overlay: { backgroundColor: colors.scrim },
    sheet: { backgroundColor: colors.background, paddingBottom: 32 + insets.bottom },
    checkCircle: { backgroundColor: colors.surfaceSubtle },
    sentText: { color: colors.textPrimary },
  });

  return (
    // Lifts the sheet over the keyboard while the save-contact row takes a name.
    <KeyboardAvoidingView behavior="padding" style={[styles.overlay, stylesHook.overlay]}>
      <View style={[styles.sheet, stylesHook.sheet]}>
        <View style={[styles.checkCircle, stylesHook.checkCircle]}>
          <CheckmarkIcon size={32} color={colors.brandPrimary} />
        </View>

        <Text style={[styles.sentText, stylesHook.sentText]}>{loc.send.sent_successfully}</Text>

        <AmountHero amount={amountStr} fiat={fiat} />

        {contact && (
          <ContactChip name={contact.name} colorIndex={contact.colorIndex} style={styles.contactChip} testID="SuccessContactChip" />
        )}

        {/* The payment is already sent, so leaving for the contact editor would strand the user
            here forever. The row takes the name on the sheet and settles into the chip above. */}
        <SaveContactRow address={recipientAddress} variant="pill" />

        <ActionButton
          title={loc.send.success_done}
          onPress={onDonePressed}
          backgroundColor={colors.brandPrimary}
          color={colors.white}
          style={[styles.sheetButton, styles.doneButton]}
          testID="successDoneButton"
        />
      </View>
    </KeyboardAvoidingView>
  );
};

export default Success;

interface SuccessViewParam {
  shouldAnimate?: boolean;
}

export const SuccessView = ({ shouldAnimate = true }: SuccessViewParam) => {
  const { colors } = useTheme();

  return (
    <View style={successViewStyles.root}>
      <View style={successViewStyles.ready}>
        <LottieView
          style={successViewStyles.lottie}
          source={require('../../img/bluenice.json')}
          autoPlay={shouldAnimate}
          loop={false}
          progress={shouldAnimate ? 0 : 1}
          colorFilters={[
            {
              keypath: 'spark',
              color: colors.brandPrimary,
            },
            {
              keypath: 'circle',
              color: colors.brandPrimary,
            },
            {
              keypath: 'Oval',
              color: colors.statusSuccess,
            },
          ]}
          resizeMode="center"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 32,
    paddingHorizontal: 24,
    gap: 20,
    alignItems: 'center',
  },
  checkCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentText: {
    fontFamily: ClashFont.medium,
    fontSize: 17,
    lineHeight: 26,
    textAlign: 'center',
  },
  // The sheet centres its children, so the buttons have to ask for the full width.
  sheetButton: {
    width: '100%',
  },
  // The chip hugs its name, so it centres rather than sitting under the sheet's left edge.
  contactChip: {
    alignSelf: 'center',
  },
  doneButton: {
    marginTop: 4,
  },
});

const successViewStyles = StyleSheet.create({
  root: {
    flex: 1,
    paddingTop: 19,
  },
  ready: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignSelf: 'center',
    alignItems: 'center',
    marginBottom: 53,
  },
  lottie: {
    width: 200,
    height: 200,
  },
});
