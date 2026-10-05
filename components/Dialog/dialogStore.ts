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
  input?: { secure?: boolean; numeric?: boolean };
}

type Listener = (current: DialogRequest | null) => void;

/**
 * One dialog at a time, in order. Plain module state so code outside React (class/, modules/) can show
 * dialogs; DialogHost subscribes and draws the head of the queue.
 */
const queue: DialogRequest[] = [];
const listeners = new Set<Listener>();
let hostCount = 0;

const notify = () => listeners.forEach(l => l(queue[0] ?? null));

export const enqueueDialog = (request: DialogRequest): void => {
  queue.push(request);
  if (queue.length === 1) notify();
};

/** Removes the shown dialog and shows the next one. The caller runs the button's handler afterwards. */
export const closeCurrentDialog = (): void => {
  queue.shift();
  notify();
};

export const subscribeDialogs = (listener: Listener): (() => void) => {
  listeners.add(listener);
  hostCount += 1;
  listener(queue[0] ?? null);
  return () => {
    listeners.delete(listener);
    hostCount -= 1;
  };
};

export const isDialogHostMounted = (): boolean => hostCount > 0;

/** Test-only reset. */
export const resetDialogs = (): void => {
  queue.length = 0;
  notify();
};
