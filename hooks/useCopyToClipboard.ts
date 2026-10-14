import Clipboard from '@react-native-clipboard/clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';

import triggerHapticFeedback, { HapticFeedbackTypes } from '../modules/hapticFeedback';

// How long `copied` stays up, long enough to read a "Copied" label swapped in for the prompt.
const COPIED_FEEDBACK_MS = 1000;

/** Copies text with a selection haptic, and raises `copied` briefly so the caller can confirm it. */
export const useCopyToClipboard = () => {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const copy = useCallback((text: string) => {
    Clipboard.setString(text);
    triggerHapticFeedback(HapticFeedbackTypes.Selection);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }, []);

  return { copied, copy };
};
