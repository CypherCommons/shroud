import React, { memo, useCallback } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ClashFont } from '../constants/fonts';
import { WordStatus } from '../helpers/recoveryPhrase';
import { WordInputHandlers } from '../hooks/useRecoveryPhraseInput';
import loc from '../loc';
import { caretProps, useTheme } from './themes';

interface WordPillProps {
  index: number;
  value: string;
  status: WordStatus;
  focused: boolean;
  isLast: boolean;
  handlers: WordInputHandlers;
}

// Memoised on its own word, status and focus, so a keystroke re-renders only the pill it lands in.
const WordPill = memo(({ index, value, status, focused, isLast, handlers }: WordPillProps) => {
  const { colors } = useTheme();
  const registerRef = useCallback((input: TextInput | null) => handlers.registerInput(index, input), [handlers, index]);
  const invalid = status === 'invalid';
  const borderColor = invalid ? colors.statusError : focused ? colors.brandPrimary : colors.revealedPillBorder;
  const indexColor = invalid ? colors.statusError : status === 'valid' ? colors.statusSuccess : colors.textMuted;
  const number = index + 1;

  return (
    // The number is part of the target too, so a tap anywhere on the pill starts typing.
    <Pressable style={[styles.pill, { borderColor }]} onPress={() => handlers.focusWord(index)} accessible={false}>
      <View
        style={[styles.indexBox, { borderColor, backgroundColor: invalid ? colors.surfaceError : colors.gridContainerBackground }]}
        // The input's label already says which word it is.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={[styles.indexText, { color: indexColor }]}>{number}</Text>
      </View>
      <TextInput
        ref={registerRef}
        value={value}
        onChangeText={text => handlers.onChangeWord(index, text)}
        onKeyPress={event => handlers.onKeyPress(index, event)}
        onFocus={() => handlers.onFocusWord(index)}
        onBlur={() => handlers.onBlurWord(index)}
        onSubmitEditing={() => handlers.onSubmitWord(index)}
        style={[styles.input, { color: invalid ? colors.statusError : colors.textPrimary }]}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        importantForAutofill="no"
        // visible-password keeps Android keyboards from learning the words into their personal
        // dictionary; autoCorrect alone doesn't stop that. It also drops their suggestion strip,
        // which would compete with the wordlist suggestions above the keyboard.
        keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
        returnKeyType={isLast ? 'done' : 'next'}
        // "submit" keeps the keyboard up while focus moves to the next pill instead of bouncing it.
        submitBehavior={isLast ? 'blurAndSubmit' : 'submit'}
        underlineColorAndroid="transparent"
        {...caretProps(colors)}
        accessibilityLabel={
          loc.formatString(invalid ? loc.wallets.restore_word_unknown : loc.wallets.restore_word_label, { number }) as string
        }
        testID={`MnemonicWordInput${number}`}
      />
    </Pressable>
  );
});

interface RecoveryPhraseGridProps {
  words: string[];
  statuses: WordStatus[];
  focusedIndex: number | null;
  handlers: WordInputHandlers;
}

/** One numbered pill per word of the phrase being entered, two to a row, in reading order. */
const RecoveryPhraseGrid: React.FC<RecoveryPhraseGridProps> = ({ words, statuses, focusedIndex, handlers }) => (
  <View style={styles.grid} testID="RecoveryPhraseGrid">
    {words.map((word, index) => (
      <WordPill
        key={index}
        index={index}
        value={word}
        status={statuses[index]}
        focused={focusedIndex === index}
        isLast={index === words.length - 1}
        handlers={handlers}
      />
    ))}
  </View>
);

export default RecoveryPhraseGrid;

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  // Same shape as the pills the phrase was first written down from (PleaseBackup), so restoring
  // reads as filling those back in.
  pill: {
    flexDirection: 'row',
    width: '48%',
    // min, not fixed: the pill grows with large text sizes instead of clipping the word.
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  indexBox: {
    width: 40,
    borderRightWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  indexText: { fontFamily: ClashFont.medium, fontSize: 13 },
  input: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 0,
    fontFamily: ClashFont.medium,
    fontSize: 15,
  },
});
