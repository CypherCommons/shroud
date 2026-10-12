import React, { forwardRef } from 'react';
import { StyleSheet, Text, View, ViewProps } from 'react-native';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';

interface SeedWordsGridProps {
  words: string[];
  revealed: boolean;
  onLayout?: ViewProps['onLayout'];
}

/**
 * The seed-word pill grid used by the Settings > Security "view recovery phrase" screen: a
 * numbered index box + word box per word, laid out two-up. `revealed` toggles between the real
 * word text and a placeholder bar, and restyles the pill borders/fills to match. The
 * wallet-creation backup screen (PleaseBackup.tsx) renders its own words via SeedWords.tsx and
 * does not use this component.
 */
const SeedWordsGrid = forwardRef<View, SeedWordsGridProps>(({ words, revealed, onLayout }, ref) => {
  const { colors } = useTheme();

  const pillColors = revealed
    ? {
        // Undefined, not a "transparent" token: RN drops an undefined style value, which renders
        // exactly as transparent (same approach as PleaseBackup).
        rowBg: undefined,
        rowBorder: colors.revealedPillBorder,
        indexBg: colors.gridContainerBackground,
        indexBorder: colors.revealedPillBorder,
      }
    : {
        rowBg: colors.surfaceBrandSubtle,
        rowBorder: colors.borderDefault,
        indexBg: colors.fieldBackground,
        indexBorder: colors.borderDefault,
      };

  return (
    <View ref={ref} onLayout={onLayout} style={[styles.wordGridWrapper, !revealed && { backgroundColor: colors.gridContainerBackground }]}>
      <View style={styles.wordsGrid}>
        {words.map((word, idx) => (
          <View key={idx} style={[styles.seedRowShadow, { shadowColor: colors.black }]}>
            <View style={[styles.seedRow, { backgroundColor: pillColors.rowBg, borderColor: pillColors.rowBorder }]}>
              <View style={[styles.seedIndexBox, { backgroundColor: pillColors.indexBg, borderColor: pillColors.indexBorder }]}>
                <Text style={[styles.seedIndexText, { color: colors.textMuted }]}>{idx + 1}</Text>
              </View>
              <View style={styles.seedWordBox}>
                {revealed ? (
                  <Text style={[styles.seedWordText, { color: colors.textPrimary }]}>{word}</Text>
                ) : (
                  // Solid bar, not real text: glyphs are too thin for the blur to hold a visible shape.
                  <View style={[styles.seedWordPlaceholder, { backgroundColor: colors.textPrimary }]} />
                )}
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
});

export default SeedWordsGrid;

const styles = StyleSheet.create({
  wordGridWrapper: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  wordsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 13,
  },
  // Outer shadow wrapper + inner clipped view: iOS clips shadows on a view with overflow:hidden.
  seedRowShadow: {
    width: '48%',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 1.5,
    elevation: 2,
  },
  seedRow: {
    flexDirection: 'row',
    width: '100%',
    height: 43,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  seedIndexBox: {
    width: 47,
    borderRightWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  seedIndexText: { fontFamily: ClashFont.medium, fontSize: 13 },
  seedWordBox: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  seedWordText: { fontFamily: ClashFont.medium, fontSize: 15 },
  // Lower opacity, not a lighter color: keeps the solid-bar shape the blur needs while matching
  // the design's subtler post-blur contrast.
  seedWordPlaceholder: {
    width: '70%',
    height: 10,
    borderRadius: 5,
    opacity: 0.35,
  },
});
