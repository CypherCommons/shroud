import { InteractionManager } from 'react-native';

import ActionSheet from '../../screen/ActionSheet';
import presentAlert from '../../components/Alert';

jest.mock('../../components/Alert');

const mockPresentAlert = presentAlert as jest.Mock;

describe('unit - ActionSheet', () => {
  beforeEach(() => {
    mockPresentAlert.mockReset();
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(task => {
      (task as () => void)();
      return { then: jest.fn(), done: jest.fn(), cancel: jest.fn() } as any;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const present = (cancelButtonIndex?: number) => {
    const completion = jest.fn();
    ActionSheet.showActionSheetWithOptions({ options: ['Cancel', 'Delete'], cancelButtonIndex }, completion);
    return { completion, options: mockPresentAlert.mock.calls[0][0].options };
  };

  it('closing with back or a tap outside reports the cancel index, including index 0', () => {
    const { completion, options } = present(0);

    expect(options.cancelable).toBe(true);
    options.onDismiss();
    expect(completion).toHaveBeenCalledWith(0);
  });

  it('cannot be closed without a button when there is no cancel option', () => {
    const { options } = present();

    expect(options.cancelable).toBe(false);
    expect(options.onDismiss).toBeUndefined();
  });

  it('reports the index of the pressed button', () => {
    const { completion } = present(0);

    mockPresentAlert.mock.calls[0][0].buttons[1].onPress();
    expect(completion).toHaveBeenCalledWith(1);
  });
});
