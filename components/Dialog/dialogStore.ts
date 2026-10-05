export type DialogButtonStyle = 'default' | 'cancel' | 'destructive';

export interface DialogButton {
  text: string;
  style?: DialogButtonStyle;
  /** Gets the input's text when the dialog has an input. */
  onPress?: (value?: string) => void;
}

export interface DialogRequest {
  title?: string;
  message?: string;
  buttons: DialogButton[];
  /** Back button / tapping outside closes it and runs `onDismiss`. */
  cancelable?: boolean;
  onDismiss?: () => void;
  input?: { secure?: boolean };
}

type Listener = (current: DialogRequest | null) => void;

/**
 * One dialog at a time, in order. Plain module state so code outside React (class/, modules/) can show
 * dialogs; DialogHost subscribes and draws the head of the queue. Emptied when the last host unmounts,
 * so a remounted tree never shows a dialog whose handlers belong to the old one.
 */
const queue: DialogRequest[] = [];
const listeners = new Set<Listener>();

const notify = () => listeners.forEach(l => l(queue[0] ?? null));

export const enqueueDialog = (request: DialogRequest): void => {
  queue.push(request);
  if (queue.length === 1) notify();
};

/**
 * Removes `request` and shows the next dialog. False if it's no longer the one showing (a second tap
 * before the re-render), so the caller must not run its handler again.
 */
export const closeDialog = (request: DialogRequest): boolean => {
  if (queue[0] !== request) return false;
  queue.shift();
  notify();
  return true;
};

export const subscribeDialogs = (listener: Listener): (() => void) => {
  listeners.add(listener);
  listener(queue[0] ?? null);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) queue.length = 0;
  };
};

export const isDialogHostMounted = (): boolean => listeners.size > 0;

/** Test-only reset. */
export const resetDialogs = (): void => {
  queue.length = 0;
  notify();
};
