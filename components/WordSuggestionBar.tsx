import React from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';

import { ClashFont } from '../constants/fonts';
import loc from '../loc';
import { useTheme } from './themes';

export const WORD_SUGGESTION_BAR_HEIGHT = 52;
// The bar keeps a fixed height so the scroll view can keep the focused pill clear of it; text
// scaled past this would spill out of it.
const MAX_FONT_SCALE = 1.4;

interface WordSuggestionBarProps {
  /** Off while the keyboard belongs to an input other than a recovery word. */
  enabled: boolean;
  typed: string;
  suggestions: string[];
  onPick: (word: string) => void;
}

/**
 * Wordlist suggestions for the recovery word being typed, riding on top of the keyboard. Render it
 * last in a full-screen container: it sits at the container's bottom edge and is pushed below the
 * screen whenever the keyboard is down, so it needs no visibility handling of its own.
 */
const WordSuggestionBar: React.FC<WordSuggestionBarProps> = ({ enabled, typed, suggestions, onPick }) => {
  const { colors } = useTheme();

  return (
    <KeyboardStickyView style={styles.sticky} offset={{ closed: WORD_SUGGESTION_BAR_HEIGHT }} enabled={enabled} testID="WordSuggestionBar">
      <View style={[styles.bar, { backgroundColor: colors.background, borderTopColor: colors.borderDefault }]}>
        {/* Persisted taps, so picking a word doesn't first take the keyboard away from the pill. */}
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.suggestions}
          testID="WordSuggestions"
        >
          {suggestions.map(word => (
            <Pressable
              key={word}
              onPress={() => onPick(word)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.chip, { backgroundColor: colors.fieldBackground }, pressed && styles.pressed]}
            >
              <Text style={[styles.chipText, { color: colors.textPrimary }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {word}
              </Text>
            </Pressable>
          ))}
          {suggestions.length === 0 && typed.length > 0 && (
            <Text style={[styles.noMatch, { color: colors.statusError }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {loc.formatString(loc.wallets.restore_no_matching_word, { word: typed })}
            </Text>
          )}
        </ScrollView>
        <Pressable onPress={Keyboard.dismiss} accessibilityRole="button" hitSlop={8} style={styles.done} testID="WordSuggestionsDone">
          <Text style={[styles.doneText, { color: colors.textBrand }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {loc.send.input_done}
          </Text>
        </Pressable>
      </View>
    </KeyboardStickyView>
  );
};

export default WordSuggestionBar;

const styles = StyleSheet.create({
  sticky: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: WORD_SUGGESTION_BAR_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  suggestions: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  chip: {
    height: 36,
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  chipText: { fontFamily: ClashFont.medium, fontSize: 15 },
  noMatch: { fontFamily: ClashFont.regular, fontSize: 14 },
  done: {
    height: '100%',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  doneText: { fontFamily: ClashFont.medium, fontSize: 16 },
});
