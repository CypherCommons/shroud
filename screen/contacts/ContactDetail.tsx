import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useIsFocused, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Clipboard from '@react-native-clipboard/clipboard';

import ActionButton from '../../components/ActionButton';
import presentAlert from '../../components/Alert';
import ContactAvatar from '../../components/ContactAvatar';
import InfoBanner from '../../components/InfoBanner';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import { useTheme } from '../../components/themes';
import { ClashFont } from '../../constants/fonts';
import { useContacts } from '../../hooks/context/useContacts';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../modules/hapticFeedback';
import { useSendToAddress } from '../../hooks/useSendToAddress';
import CopyIcon from '../../components/icons/CopyIcon';
import EditIcon from '../../components/icons/EditIcon';
import PaperPlaneIcon from '../../components/icons/PaperPlaneIcon';
import TrashIcon from '../../components/icons/TrashIcon';

type RouteProps = RouteProp<DetailViewStackParamList, 'ContactDetail'>;

const ContactDetail: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();
  const insets = useSafeAreaInsets();
  const { params } = useRoute<RouteProps>();
  const { getContact, deleteContact } = useContacts();
  const sendToAddress = useSendToAddress();
  const [copied, setCopied] = useState(false);

  const contact = getContact(params.address);

  // Only while focused: goBack() carries this screen's route key, so firing it from underneath
  // ContactEdit would pop this route out from below the form the user is still filling in.
  const isFocused = useIsFocused();
  const hasLeft = useRef(false);
  useEffect(() => {
    if (contact !== undefined || !isFocused || hasLeft.current) return;
    hasLeft.current = true;
    navigation.goBack();
  }, [contact, isFocused, navigation]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1000);
    return () => clearTimeout(timer);
  }, [copied]);

  const HeaderRight = useMemo(
    () => (
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('ContactEdit', { mode: 'edit', address: params.address })}
        testID="ContactEditButton"
        style={styles.editButton}
      >
        <EditIcon size={20} color={colors.brandPrimary} />
        <Text style={[styles.editLabel, { color: colors.textBrand }]}>{loc._.edit}</Text>
      </Pressable>
    ),
    [navigation, params.address, colors.brandPrimary, colors.textBrand],
  );

  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => HeaderRight });
  }, [navigation, HeaderRight]);

  if (contact === undefined) return null;

  const onPay = () => sendToAddress(params.address);

  // The copy button tints while it holds, the way DetailRow's does: without any acknowledgement a
  // tap on the address reads as a no-op.
  const onCopyAddress = () => {
    Clipboard.setString(params.address);
    triggerHapticFeedback(HapticFeedbackTypes.Selection);
    setCopied(true);
  };

  // Like every other irreversible action in the app, the button names the verb — see hooks/useDeleteWallet.
  const onRemove = () =>
    presentAlert({
      title: loc.contacts.remove_confirm_title,
      message: loc.contacts.remove_confirm_message,
      buttons: [
        { text: loc._.cancel, style: 'cancel' },
        {
          text: loc.contacts.remove_confirm_action,
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteContact(params.address);
            } catch (error: any) {
              presentAlert({ message: error?.message ?? String(error) });
            }
          },
        },
      ],
      options: { cancelable: false },
    });

  return (
    <SafeAreaScrollView testID="ContactDetailScrollView" contentContainerStyle={styles.content}>
      <View style={styles.body}>
        <View style={styles.header}>
          <ContactAvatar name={contact.name} colorIndex={contact.colorIndex} size={72} borderRadius={24} />
          <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1} ellipsizeMode="tail" testID="ContactDetailName">
            {contact.name}
          </Text>
        </View>

        <ActionButton
          title={loc.contacts.pay}
          Icon={PaperPlaneIcon}
          iconSize={20}
          onPress={onPay}
          backgroundColor={colors.brandPrimary}
          color={colors.white}
          testID="ContactPayButton"
        />

        <View style={styles.addressSection}>
          <View style={styles.addressHead}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>{loc.contacts.label_address}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={loc.transactions.details_copy}
              hitSlop={10}
              onPress={onCopyAddress}
              testID="ContactCopyAddressIconButton"
              style={[styles.copyButton, { backgroundColor: colors.background, borderColor: colors.borderDefault }]}
            >
              <CopyIcon size={16} color={copied ? colors.brandPrimary : colors.iconSecondary} />
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={loc.transactions.details_copy}
            onPress={onCopyAddress}
            testID="ContactCopyAddressButton"
            style={[styles.addressBox, { backgroundColor: colors.surfaceSubtle, borderColor: colors.accentSubtle }]}
          >
            <Text style={[styles.address, { color: colors.textPrimary }]}>{params.address}</Text>
          </Pressable>
        </View>

        <InfoBanner text={loc.contacts.reuse_notice} emphasis={loc.contacts.reuse_notice_emphasis} />
      </View>

      <View style={styles.spacer} />

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        <ActionButton
          title={loc.contacts.remove}
          Icon={TrashIcon}
          onPress={onRemove}
          backgroundColor={colors.surfaceCaution}
          color={colors.statusError}
          borderColor={colors.statusError}
          testID="ContactRemoveButton"
        />
      </View>
    </SafeAreaScrollView>
  );
};

export default ContactDetail;

const styles = StyleSheet.create({
  editButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editLabel: { fontFamily: ClashFont.medium, fontSize: 16 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 0 },
  body: { gap: 24 },
  header: { alignItems: 'center', gap: 12 },
  name: { fontFamily: ClashFont.medium, fontSize: 28, letterSpacing: -1 },
  addressSection: { gap: 8 },
  addressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontFamily: ClashFont.medium, fontSize: 14 },
  copyButton: {
    width: 24,
    height: 24,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressBox: { borderRadius: 16, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 12 },
  address: { fontFamily: ClashFont.regular, fontSize: 14, lineHeight: 22 },
  spacer: { flex: 1 },
  footer: { paddingTop: 32 },
});
