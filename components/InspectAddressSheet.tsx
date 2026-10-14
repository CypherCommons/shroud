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
const GROUP_SIZE = 4;
const GROUPS_PER_ROW = 4;
// Invisible characters that pad a short or missing group to full width.
const PADDING = '0'.repeat(GROUP_SIZE);
// The grid is already large; past this the four groups of a row stop fitting a 320pt screen.
const MAX_GRID_FONT_SCALE = 1.25;

interface InspectAddressSheetProps {
  address?: string;
}

// The whole address, for checking it character by character against the sender's copy.
const InspectAddressSheet = forwardRef<BottomModalHandle, InspectAddressSheetProps>(({ address = '' }, ref) => {
  const { colors } = useTheme();
  const { copied, copy } = useCopyToClipboard();
  // Groups of four, four to a row, in columns alternately bright and dim so the eye keeps its place.
  const groups = address.match(new RegExp(`.{1,${GROUP_SIZE}}`, 'g')) ?? [];
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
              {Array.from({ length: GROUPS_PER_ROW }, (_, column) => {
                const group = row[column] ?? '';
                return (
                  <View key={column} style={styles.cell}>
                    <Text
                      maxFontSizeMultiplier={MAX_GRID_FONT_SCALE}
                      style={[styles.group, { color: column % 2 === 0 ? colors.textPrimary : colors.textMuted }]}
                    >
                      {group}
                    </Text>
                    {/* A sibling rather than a nested span: Android ignores a transparent colour on a span. */}
                    {group.length < GROUP_SIZE && (
                      <Text maxFontSizeMultiplier={MAX_GRID_FONT_SCALE} style={[styles.group, styles.padding]}>
                        {PADDING.slice(group.length)}
                      </Text>
                    )}
                  </View>
                );
              })}
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
  // Capped so the columns don't drift apart on a wide screen, and centred under the title.
  grid: { width: '100%', maxWidth: 300, alignSelf: 'center' },
  // Every cell is four monospace characters wide, padding included, so spreading each row across
  // the grid lines the columns up and narrows the gaps on a narrow screen instead of wrapping.
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cell: { flexDirection: 'row' },
  group: { fontFamily: MONOSPACE, fontSize: 22, lineHeight: 34 },
  padding: { opacity: 0 },
});
