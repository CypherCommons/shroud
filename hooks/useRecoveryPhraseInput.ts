import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, NativeSyntheticEvent, TextInput, TextInputKeyPressEventData } from 'react-native';
import { KeyboardEvents } from 'react-native-keyboard-controller';

import {
  assessPhrase,
  emptyGrid,
  GridSize,
  MIN_PHRASE_WORDS,
  PhraseGrid,
  placeWords,
  visibleWords,
  withWord,
  wordStatuses,
} from '../helpers/recoveryPhrase';
import { hasWordBreak, mnemonicWords, mnemonicWordsAsTyped } from '../modules/bip39';
import { completeMnemonicWord, isMnemonicWord, suggestMnemonicWords } from '../modules/mnemonicWords';
import { triggerSelectionHapticFeedback, triggerWarningHapticFeedback } from '../modules/hapticFeedback';

const MAX_SUGGESTIONS = 8;
// How long a pill that lost focus waits for another pill to pick it up before the suggestion bar
// lets go of the keyboard. Moving between pills fires a blur and then a focus.
export const FOCUS_HANDOFF_MS = 100;

/** What each pill calls. Every function keeps its identity across renders, so pills can be memoised. */
export interface WordInputHandlers {
  registerInput: (index: number, input: TextInput | null) => void;
  focusWord: (index: number) => void;
  onChangeWord: (index: number, text: string) => void;
  onKeyPress: (index: number, event: NativeSyntheticEvent<TextInputKeyPressEventData>) => void;
  onFocusWord: (index: number) => void;
  onBlurWord: (index: number) => void;
  onSubmitWord: (index: number) => void;
}

/**
 * State and behaviour for typing a recovery phrase one word per pill: suggestions, moving between
 * pills, and spreading a pasted or scanned phrase over them. The rules for filling and judging the
 * grid live in helpers/recoveryPhrase.
 */
export const useRecoveryPhraseInput = () => {
  const [grid, setGrid] = useState<PhraseGrid>(() => emptyGrid());
  // The pill with focus right now, which decides whether a half-typed word is still being typed.
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  // The pill the suggestion bar serves. Unlike focusedIndex it outlives a blur, so the bar keeps its
  // words while focus hops between pills or while it rides the keyboard down.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // Whether the keyboard belongs to a pill, which is when the suggestion bar sits on it.
  const [ownsKeyboard, setOwnsKeyboard] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<{ index: number } | null>(null);
  const inputs = useRef<(TextInput | null)[]>([]);
  // Handlers read and write through refs so two events landing before a re-render (a second
  // keystroke, the blur that follows a commit) see each other's changes.
  const gridRef = useRef(grid);
  const focusedIndexRef = useRef<number | null>(null);
  const activeIndexRef = useRef<number | null>(null);
  const keyboardHidingRef = useRef(false);
  const handoffTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const activate = useCallback((index: number | null) => {
    activeIndexRef.current = index;
    setActiveIndex(index);
  }, []);

  const update = useCallback(
    (next: PhraseGrid) => {
      gridRef.current = next;
      setGrid(next);
      if (activeIndexRef.current !== null && activeIndexRef.current >= next.size) activate(null);
      // The focused pill was cut off by a smaller grid; it unmounts without a blur.
      if (focusedIndexRef.current !== null && focusedIndexRef.current >= next.size) {
        focusedIndexRef.current = null;
        setFocusedIndex(null);
        Keyboard.dismiss();
      }
    },
    [activate],
  );

  const setWord = useCallback(
    (index: number, word: string) => {
      if (gridRef.current.words[index] !== word) update(withWord(gridRef.current, index, word));
    },
    [update],
  );

  // A pill that the grid only just grew to include mounts on the next render, so focus waits for it.
  useEffect(() => {
    if (pendingFocus) inputs.current[pendingFocus.index]?.focus();
  }, [pendingFocus]);

  const focusWord = useCallback((index: number) => {
    const input = inputs.current[index];
    if (input) input.focus();
    else setPendingFocus({ index });
  }, []);

  const advanceFrom = useCallback(
    (index: number) => {
      if (index + 1 < gridRef.current.size) focusWord(index + 1);
      else Keyboard.dismiss();
    },
    [focusWord],
  );

  // Ends the word in a pill: completes a prefix only one word can finish, then moves on as asked.
  const commitWord = useCallback(
    (index: number, typed: string, advance: 'always' | 'if-valid' | 'never') => {
      const others = visibleWords(gridRef.current).filter((_, i) => i !== index);
      const word = completeMnemonicWord(typed, others) ?? typed;
      setWord(index, word);
      if (advance === 'always' || (advance === 'if-valid' && isMnemonicWord(word))) {
        advanceFrom(index);
      } else if (advance === 'if-valid' && word) {
        // The space didn't move on, so say why without the user having to look up.
        triggerWarningHapticFeedback();
      }
    },
    [advanceFrom, setWord],
  );

  const onChangeWord = useCallback(
    (index: number, text: string) => {
      if (!hasWordBreak(text)) {
        setWord(index, text.toLowerCase());
        return;
      }

      const typed = mnemonicWordsAsTyped(text);
      if (typed.length <= 1) {
        // A space (or anything normalizeMnemonic treats as one) ends the word.
        commitWord(index, typed[0] ?? '', 'if-valid');
        return;
      }

      // Pasted, or typed faster than focus could follow the last space ("aba a" in one pill): spread
      // the words over the pills from here on. A last word with no break after it is still being
      // typed, so it stays as typed and keeps focus.
      const stillTyping = !hasWordBreak(text.slice(-1));
      const incoming = mnemonicWords(text);
      if (stillTyping) incoming[incoming.length - 1] = typed[typed.length - 1];
      const placed = placeWords(gridRef.current, index, incoming, false);
      update(placed.grid);
      if (incoming.length >= MIN_PHRASE_WORDS || (!stillTyping && placed.next >= placed.grid.size)) Keyboard.dismiss();
      else focusWord(stillTyping ? placed.next - 1 : placed.next);
    },
    [commitWord, focusWord, setWord, update],
  );

  const onKeyPress = useCallback(
    (index: number, { nativeEvent }: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      // Backspace in an empty pill steps back to the one before, like deleting across a space.
      if (nativeEvent.key === 'Backspace' && !gridRef.current.words[index] && index > 0) focusWord(index - 1);
    },
    [focusWord],
  );

  const onFocusWord = useCallback(
    (index: number) => {
      clearTimeout(handoffTimerRef.current);
      focusedIndexRef.current = index;
      setFocusedIndex(index);
      activate(index);
      setOwnsKeyboard(true);
    },
    [activate],
  );

  const onBlurWord = useCallback(
    (index: number) => {
      if (focusedIndexRef.current === index) focusedIndexRef.current = null;
      setFocusedIndex(current => (current === index ? null : current));
      const typed = gridRef.current.words[index];
      if (typed) commitWord(index, typed, 'never');

      clearTimeout(handoffTimerRef.current);
      handoffTimerRef.current = setTimeout(() => {
        // No pill took focus and the keyboard is staying up: another input has it now.
        if (focusedIndexRef.current === null && !keyboardHidingRef.current) setOwnsKeyboard(false);
      }, FOCUS_HANDOFF_MS);
    },
    [commitWord],
  );

  const onSubmitWord = useCallback((index: number) => commitWord(index, gridRef.current.words[index] ?? '', 'always'), [commitWord]);

  const registerInput = useCallback((index: number, input: TextInput | null) => {
    inputs.current[index] = input;
  }, []);

  // When the keyboard is going down, the bar rides down with it and lets go once it's out of sight.
  useEffect(() => {
    const subscriptions = [
      KeyboardEvents.addListener('keyboardWillShow', () => {
        keyboardHidingRef.current = false;
      }),
      KeyboardEvents.addListener('keyboardWillHide', () => {
        keyboardHidingRef.current = true;
      }),
      KeyboardEvents.addListener('keyboardDidHide', () => {
        if (focusedIndexRef.current === null) setOwnsKeyboard(false);
      }),
    ];
    return () => {
      subscriptions.forEach(subscription => subscription.remove());
      clearTimeout(handoffTimerRef.current);
    };
  }, []);

  const handlers = useMemo<WordInputHandlers>(
    () => ({ registerInput, focusWord, onChangeWord, onKeyPress, onFocusWord, onBlurWord, onSubmitWord }),
    [registerInput, focusWord, onChangeWord, onKeyPress, onFocusWord, onBlurWord, onSubmitWord],
  );

  const acceptSuggestion = useCallback(
    (word: string) => {
      const index = activeIndexRef.current;
      if (index === null) return;
      triggerSelectionHapticFeedback();
      setWord(index, word);
      advanceFrom(index);
    },
    [advanceFrom, setWord],
  );

  /** Fills the grid from pasted or scanned text, replacing anything typed. Returns the phrase if it's valid. */
  const fillFromText = useCallback(
    (text: string): string | null => {
      const incoming = mnemonicWords(text);
      if (incoming.length === 0) return null;
      const { grid: next } = placeWords(gridRef.current, 0, incoming, true);
      update(next);
      Keyboard.dismiss();
      return assessPhrase(next, wordStatuses(next, null), null).phrase;
    },
    [update],
  );

  /** Shows 12 or 24 pills. Words past a smaller grid's end stay, hidden, until it grows again. */
  const setWordCount = useCallback((size: GridSize) => update({ ...gridRef.current, size }), [update]);

  const clear = useCallback(() => update(emptyGrid(gridRef.current.size)), [update]);

  const words = useMemo(() => visibleWords(grid), [grid]);
  const statuses = useMemo(() => wordStatuses(grid, focusedIndex), [grid, focusedIndex]);
  const { phrase, note } = useMemo(() => assessPhrase(grid, statuses, focusedIndex), [grid, statuses, focusedIndex]);

  const activeWord = activeIndex === null ? '' : (words[activeIndex] ?? '');
  const suggestions = useMemo(
    () =>
      activeIndex === null
        ? []
        : suggestMnemonicWords(
            activeWord,
            words.filter((_, i) => i !== activeIndex),
            MAX_SUGGESTIONS,
          ),
    [activeIndex, activeWord, words],
  );

  return {
    /** The pills on screen. */
    words,
    wordCount: grid.size,
    statuses,
    focusedIndex,
    handlers,
    /** Whether the suggestion bar should sit on the keyboard. */
    ownsKeyboard,
    activeWord,
    suggestions,
    acceptSuggestion,
    /** The entered phrase once it's valid, otherwise null. */
    phrase,
    /** Why there's no phrase yet, when there's something to say. */
    note,
    fillFromText,
    setWordCount,
    clear,
  };
};

export type RecoveryPhraseInput = ReturnType<typeof useRecoveryPhraseInput>;
