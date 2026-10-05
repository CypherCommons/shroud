import assert from 'assert';
import { Alert } from 'react-native';

import { closeCurrentDialog, DialogRequest, enqueueDialog, resetDialogs, subscribeDialogs } from '../../components/Dialog/dialogStore';
import presentAlert from '../../components/Alert';
import prompt from '../../helpers/prompt';

describe('unit - dialog queue', () => {
  let shown: (DialogRequest | null)[];
  let unsubscribe: () => void;

  beforeEach(() => {
    resetDialogs();
    shown = [];
    unsubscribe = subscribeDialogs(current => shown.push(current));
  });

  afterEach(() => unsubscribe());

  it('shows dialogs one at a time, in order', () => {
    enqueueDialog({ title: 'first', buttons: [] });
    enqueueDialog({ title: 'second', buttons: [] });

    assert.strictEqual(shown[shown.length - 1]?.title, 'first');
    closeCurrentDialog();
    assert.strictEqual(shown[shown.length - 1]?.title, 'second');
    closeCurrentDialog();
    assert.strictEqual(shown[shown.length - 1], null);
  });

  it('presentAlert goes to the dialog while a host is mounted, with its buttons and options', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const onPress = jest.fn();

    presentAlert({
      title: 'Delete wallet?',
      message: 'msg',
      buttons: [{ text: 'Delete', style: 'destructive', onPress }],
      options: { cancelable: true },
    });

    const current = shown[shown.length - 1];
    assert.strictEqual(alertSpy.mock.calls.length, 0);
    assert.strictEqual(current?.title, 'Delete wallet?');
    assert.strictEqual(current?.cancelable, true);
    current?.buttons[0].onPress?.();
    assert.strictEqual(onPress.mock.calls.length, 1);
    alertSpy.mockRestore();
  });

  it('presentAlert falls back to the system alert when no host is mounted', () => {
    unsubscribe();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    presentAlert({ message: 'no host yet' });

    assert.strictEqual(alertSpy.mock.calls.length, 1);
    alertSpy.mockRestore();
    unsubscribe = subscribeDialogs(current => shown.push(current));
  });

  it('prompt resolves with the typed text', async () => {
    const result = prompt('Password', 'Enter it', false);
    const current = shown[shown.length - 1];

    assert.strictEqual(current?.input?.secure, true);
    assert.strictEqual(current?.buttons.length, 1);
    current?.buttons[0].onPress?.('hunter2');
    assert.strictEqual(await result, 'hunter2');
  });

  it('prompt rejects when cancelled', async () => {
    const result = prompt('Password', 'Enter it');
    const cancel = shown[shown.length - 1]?.buttons.find(b => b.style === 'cancel');

    cancel?.onPress?.();
    await assert.rejects(result);
  });
});
