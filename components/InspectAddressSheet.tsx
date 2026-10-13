import React, { forwardRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import ActionButton from './ActionButton';
import BottomModal, { BottomModalHandle } from './BottomModal';
import CopyIcon from './icons/CopyIcon';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import loc from '../loc';

// The app bundles no monospace face; these are the platforms' own. React Native on iOS doesn't
// resolve the generic 'monospace' family, so it needs a real font name.
const MONOSPACE = Platform.select({ ios: 'Menlo', default: 'monospace' });
const GROUPS_PER_ROW = 4;

interface InspectAddressSheetProps {
  address?: string;
}

// The whole address, for checking it character by character against the sender's copy.
const InspectAddressSheet = forwardRef<BottomModalHandle, InspectAddressSheetProps>(({ address = '' }, ref) => {
  const { colors } = useTheme();
  const { copied, copy } = useCopyToClipboard();
  // Groups of four, four to a row, in columns alternately bright and dim so the eye keeps its place.
  const groups = address.match(/.{1,4}/g) ?? [];
  const rows: string[][] = [];
  for (let i = 0; i < groups.length; i += GROUPS_PER_ROW) rows.push(groups.slice(i, i + GROUPS_PER_ROW));

  return (
    <BottomModal
      ref={ref}
      detents={['auto']}
      // Rounds the top corners only; the native sheet squares off the bottom two.
      cornerRadius={16}
      backgroundColor={colors.background}
      showCloseButton={false}
      contentStyle={styles.sheet}
    >
      <View style={styles.container} testID="InspectAddressSheet">
        <Text style={[styles.title, { color: colors.textPrimary }]}>{loc.receive.inspect_address}</Text>
        <View style={styles.grid} accessible accessibilityLabel={groups.join(' ')}>
          {rows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.row}>
              {row.map((group, column) => (
                <Text key={column} style={[styles.group, { color: column % 2 === 0 ? colors.textPrimary : colors.textMuted }]}>
                  {group}
                </Text>
              ))}
            </View>
          ))}
        </View>
        <ActionButton
          title={copied ? loc.receive.copied : loc.receive.copy_address}
          Icon={CopyIcon}
          iconSize={20}
          onPress={() => copy(address)}
          backgroundColor={colors.brandPrimary}
          color={colors.white}
          testID="InspectAddressCopyButton"
        />
      </View>
    </BottomModal>
  );
});

export default InspectAddressSheet;

const styles = StyleSheet.create({
  sheet: { paddingTop: 0, paddingHorizontal: 0 },
  // The top padding clears the native grabber.
  container: { paddingTop: 28, paddingHorizontal: 24, paddingBottom: 24, gap: 24 },
  title: { fontFamily: ClashFont.medium, fontSize: 17, lineHeight: 26, textAlign: 'center' },
  // As wide as a full row, so the block centres under the title. Every full group is the same width
  // in a monospace face, which is what keeps the columns lined up without fixing their widths.
  grid: { alignSelf: 'center' },
  // Wraps only if very large text makes a row wider than the sheet.
  row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 28 },
  group: { fontFamily: MONOSPACE, fontSize: 22, lineHeight: 34 },
});
