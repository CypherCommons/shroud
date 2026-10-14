import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ShroudText } from '../ShroudComponents';
import { ClashFont } from '../constants/fonts';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import loc from '../loc';
import { shortenAddress } from '../utils/transactionHelpers';
import CopyIcon from './icons/CopyIcon';
import EyeIcon from './icons/EyeIcon';
import { useTheme } from './themes';

interface AddressCopyCardProps {
  text: string;
  /** Adds an eye button for reading the whole address, which the card itself only shows the ends of. */
  onInspect?: () => void;
  testID?: string;
}

// Characters kept from each end of the address; tapping still copies all of it. Eight rather than
// fewer because a silent payment address opens with five or six characters every address shares.
const VISIBLE_CHARS = 8;
const PADDING = 16;
const INSPECT_BUTTON_SIZE = 36;

const AddressCopyCard: React.FC<AddressCopyCardProps> = ({ text, onInspect, testID = 'AddressCopyCard' }) => {
  const { colors } = useTheme();
  const { copied, copy } = useCopyToClipboard();

  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceSubtle }]}>
      <Pressable
        onPress={() => copy(text)}
        accessibilityRole="button"
        testID={testID}
        style={[styles.copyArea, onInspect && styles.copyAreaBesideInspect]}
      >
        <ShroudText testID="AddressValue" style={[styles.address, { color: colors.textSecondary }]}>
          {shortenAddress(text, VISIBLE_CHARS, VISIBLE_CHARS)}
        </ShroudText>
        <View style={styles.copyRow}>
          <CopyIcon size={16} color={colors.textMuted} />
          <ShroudText style={[styles.copyLabel, { color: colors.textMuted }]}>
            {copied ? loc.receive.copied : loc.receive.tap_to_copy}
          </ShroudText>
        </View>
      </Pressable>
      {onInspect && (
        // Laid over the copy area rather than inside it, so a screen reader can reach it as its own button.
        <View style={styles.inspectSlot} pointerEvents="box-none">
          <Pressable
            onPress={onInspect}
            accessibilityRole="button"
            accessibilityLabel={loc.receive.inspect_address}
            hitSlop={8}
            testID={`${testID}InspectButton`}
            style={[styles.inspectButton, { backgroundColor: colors.background }]}
          >
            <EyeIcon size={20} color={colors.iconSecondary} />
          </Pressable>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: 16,
  },
  copyArea: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: PADDING,
  },
  // Keeps the text clear of the eye button, and mirrors that on the left so the address stays
  // centred on the card.
  copyAreaBesideInspect: {
    paddingHorizontal: PADDING + INSPECT_BUTTON_SIZE + 8,
  },
  address: {
    fontFamily: ClashFont.regular,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  copyLabel: {
    fontFamily: ClashFont.regular,
    fontSize: 12,
    lineHeight: 20,
    letterSpacing: -0.15,
  },
  inspectSlot: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: PADDING,
    justifyContent: 'center',
  },
  inspectButton: {
    width: INSPECT_BUTTON_SIZE,
    height: INSPECT_BUTTON_SIZE,
    borderRadius: INSPECT_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AddressCopyCard;
