import assert from 'assert';
import { Keyboard, TextInput } from 'react-native';
import { KeyboardEvents } from 'react-native-keyboard-controller';
import { act, renderHook } from '@testing-library/react-native';

import { FOCUS_HANDOFF_MS, useRecoveryPhraseInput } from '../../hooks/useRecoveryPhraseInput';
import { triggerWarningHapticFeedback } from '../../modules/hapticFeedback';

jest.mock('../../modules/hapticFeedback');

const phraseOf = (words: number, last: string) => [...Array(words - 1).fill('abandon'), last].join(' ');
const PHRASE_12 = phraseOf(12, 'about');
const PHRASE_18 = phraseOf(18, 'agent');
const PHRASE_24 = phraseOf(24, 'art');

type Hook = ReturnType<typeof setup>['result'];

// Stand-ins for the pills' TextInputs, so the test can see which one the hook focuses.
const setup = () => {
  const rendered = renderHook(() => useRecoveryPhraseInput());
  const inputs = Array.from({ length: 24 }, () => ({ focus: jest.fn() }));
  act(() => inputs.forEach((input, i) => rendered.result.current.handlers.registerInput(i, input as unknown as TextInput)));
  const focusedInputs = () => inputs.flatMap((input, i) => (input.focus.mock.calls.length > 0 ? [i] : []));
  return { ...rendered, inputs, focusedInputs };
};

const type = (result: Hook, index: number, text: string) => act(() => result.current.handlers.onChangeWord(index, text));
const focus = (result: Hook, index: number) => act(() => result.current.handlers.onFocusWord(index));
const blur = (result: Hook, index: number) => act(() => result.current.handlers.onBlurWord(index));

const keyboardEvent = (name: string) => {
  const listeners = (KeyboardEvents.addListener as jest.Mock).mock.calls.filter(([event]) => event === name);
  act(() => listeners[listeners.length - 1][1]({}));
};

describe('useRecoveryPhraseInput', () => {
  let dismiss: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  });

  afterEach(() => {
    dismiss.mockRestore();
    jest.useRealTimers();
  });

  it('starts with twelve empty pills and nothing to say', () => {
    const { result } = setup();
    assert.strictEqual(result.current.words.length, 12);
    assert.strictEqual(result.current.phrase, null);
    assert.strictEqual(result.current.note, null);
  });

  describe('typing a word', () => {
    it('lowercases what the keyboard capitalised', () => {
      const { result } = setup();
      type(result, 0, 'Zoo');
      assert.strictEqual(result.current.words[0], 'zoo');
    });

    it('ends the word on a space, completing a prefix only one word can finish, and moves to the next pill', () => {
      const { result, focusedInputs } = setup();
      focus(result, 0);
      type(result, 0, 'aban ');
      assert.strictEqual(result.current.words[0], 'abandon');
      assert.deepStrictEqual(focusedInputs(), [1]);
    });

    it("stays on a word that isn't on the list, and buzzes since the space did nothing", () => {
      const { result, focusedInputs } = setup();
      focus(result, 0);
      type(result, 0, 'poil ');
      assert.strictEqual(result.current.words[0], 'poil');
      assert.deepStrictEqual(focusedInputs(), []);
      assert.strictEqual((triggerWarningHapticFeedback as jest.Mock).mock.calls.length, 1);
    });

    it('moves on with the return key even past a word that is wrong', () => {
      const { result, focusedInputs } = setup();
      type(result, 0, 'poil');
      act(() => result.current.handlers.onSubmitWord(0));
      assert.deepStrictEqual(focusedInputs(), [1]);
    });

    it('closes the keyboard when the last word is finished', () => {
      const { result } = setup();
      type(result, 11, 'about');
      act(() => result.current.handlers.onSubmitWord(11));
      assert.strictEqual(dismiss.mock.calls.length, 1);
    });

    it('completes a unique prefix when the pill loses focus', () => {
      const { result } = setup();
      focus(result, 0);
      type(result, 0, 'acti');
      blur(result, 0);
      assert.strictEqual(result.current.words[0], 'action');
    });

    it('steps back to the previous pill on backspace in an empty one, and only then', () => {
      const { result, focusedInputs } = setup();
      const backspace = (index: number) =>
        act(() => result.current.handlers.onKeyPress(index, { nativeEvent: { key: 'Backspace' } } as never));

      backspace(0);
      type(result, 3, 'zo');
      backspace(3);
      assert.deepStrictEqual(focusedInputs(), []);

      backspace(2);
      assert.deepStrictEqual(focusedInputs(), [1]);
    });

    it('keeps up with letters typed before focus could follow the space', () => {
      const { result, focusedInputs } = setup();
      type(result, 0, 'aba a');
      assert.deepStrictEqual(result.current.words.slice(0, 2), ['abandon', 'a']);
      assert.deepStrictEqual(focusedInputs(), [1]);
    });
  });

  describe('suggestions', () => {
    it('lists the words the focused pill can still become, and the picked one moves focus on', () => {
      const { result, focusedInputs } = setup();
      focus(result, 2);
      type(result, 2, 'act');
      assert.deepStrictEqual(result.current.suggestions, ['act', 'action', 'actor', 'actress', 'actual']);

      act(() => result.current.acceptSuggestion('actress'));
      assert.strictEqual(result.current.words[2], 'actress');
      assert.deepStrictEqual(focusedInputs(), [3]);
    });
  });

  describe('the suggestion bar', () => {
    beforeEach(() => jest.useFakeTimers());

    it('takes the keyboard when a pill gets focus', () => {
      const { result } = setup();
      assert.strictEqual(result.current.ownsKeyboard, false);
      focus(result, 0);
      assert.strictEqual(result.current.ownsKeyboard, true);
    });

    it('keeps it while focus moves from one pill to another', () => {
      const { result } = setup();
      focus(result, 0);
      blur(result, 0);
      focus(result, 1);
      act(() => jest.advanceTimersByTime(FOCUS_HANDOFF_MS));
      assert.strictEqual(result.current.ownsKeyboard, true);
    });

    it('lets go when an input outside the grid takes the keyboard', () => {
      const { result } = setup();
      focus(result, 0);
      blur(result, 0);
      assert.strictEqual(result.current.ownsKeyboard, true);
      act(() => jest.advanceTimersByTime(FOCUS_HANDOFF_MS));
      assert.strictEqual(result.current.ownsKeyboard, false);
    });

    it('rides the keyboard down when it closes, and lets go once it is gone', () => {
      const { result } = setup();
      focus(result, 0);
      keyboardEvent('keyboardWillHide');
      blur(result, 0);
      act(() => jest.advanceTimersByTime(FOCUS_HANDOFF_MS));
      assert.strictEqual(result.current.ownsKeyboard, true);

      keyboardEvent('keyboardDidHide');
      assert.strictEqual(result.current.ownsKeyboard, false);
    });

    it('stays with a pill that keeps focus while the keyboard is hidden', () => {
      const { result } = setup();
      focus(result, 0);
      keyboardEvent('keyboardDidHide');
      assert.strictEqual(result.current.ownsKeyboard, true);
    });
  });

  describe('pasting', () => {
    it('spreads a whole phrase over the grid from the first pill, wherever it was pasted, and closes the keyboard', () => {
      const { result } = setup();
      type(result, 4, PHRASE_12);
      assert.deepStrictEqual(result.current.words, PHRASE_12.split(' '));
      assert.strictEqual(result.current.phrase, PHRASE_12);
      assert.strictEqual(dismiss.mock.calls.length, 1);
    });

    it('moves on to the pill after a few pasted words', () => {
      const { result, focusedInputs } = setup();
      type(result, 4, 'abandon ability able ');
      assert.deepStrictEqual(result.current.words.slice(4, 8), ['abandon', 'ability', 'able', '']);
      assert.deepStrictEqual(focusedInputs(), [7]);
    });

    it('switches to 24 pills for a 24-word phrase, and back for a 12-word one', () => {
      const { result } = setup();
      type(result, 0, PHRASE_24);
      assert.strictEqual(result.current.wordCount, 24);
      assert.strictEqual(result.current.phrase, PHRASE_24);

      act(() => {
        result.current.fillFromText(PHRASE_12);
      });
      assert.strictEqual(result.current.wordCount, 12);
      assert.strictEqual(result.current.phrase, PHRASE_12);
    });

    it('accepts an 18-word phrase in the 24-word grid', () => {
      const { result } = setup();
      act(() => {
        result.current.fillFromText(PHRASE_18);
      });
      assert.strictEqual(result.current.wordCount, 24);
      assert.strictEqual(result.current.phrase, PHRASE_18);
    });

    it('returns the phrase when the pasted text is a valid one, so a scan can restore straight away', () => {
      const { result } = setup();
      let filled: string | null = null;
      act(() => {
        filled = result.current.fillFromText(`0000${'0000'.repeat(10)}0003`);
      });
      assert.strictEqual(filled, PHRASE_12);

      act(() => {
        filled = result.current.fillFromText('not a phrase');
      });
      assert.strictEqual(filled, null);
      assert.strictEqual(result.current.note?.kind, 'unknown_words');
    });

    it('leaves the words alone when the clipboard holds no words', () => {
      const { result } = setup();
      type(result, 0, 'zoo');
      act(() => {
        result.current.fillFromText(' \n');
      });
      assert.strictEqual(result.current.words[0], 'zoo');
    });
  });

  describe('the word count', () => {
    it('keeps the words of a 24-word phrase through a switch to 12 and back', () => {
      const { result } = setup();
      act(() => {
        result.current.fillFromText(PHRASE_24);
      });
      act(() => result.current.setWordCount(12));
      assert.deepStrictEqual(result.current.words, PHRASE_24.split(' ').slice(0, 12));
      assert.strictEqual(result.current.phrase, null);

      act(() => result.current.setWordCount(24));
      assert.strictEqual(result.current.phrase, PHRASE_24);
    });

    it('closes the keyboard when the pill it was typing in goes away', () => {
      const { result } = setup();
      act(() => result.current.setWordCount(24));
      focus(result, 20);
      act(() => result.current.setWordCount(12));
      assert.strictEqual(result.current.focusedIndex, null);
      assert.strictEqual(dismiss.mock.calls.length, 1);
    });
  });

  it('clears every pill, including the ones a smaller grid hides', () => {
    const { result } = setup();
    act(() => {
      result.current.fillFromText(PHRASE_24);
    });
    act(() => result.current.setWordCount(12));
    act(() => result.current.clear());
    act(() => result.current.setWordCount(24));
    assert.ok(result.current.words.every(word => word === ''));
  });
});
