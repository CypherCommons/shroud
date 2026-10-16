import { isUpdateGateEnabled } from '../../helpers/e2e';

const launchArguments = jest.requireMock('react-native-launch-arguments').LaunchArguments as { value: () => object };

describe('unit - isUpdateGateEnabled', () => {
  const dev = (global as any).__DEV__;
  const value = launchArguments.value;

  afterEach(() => {
    (global as any).__DEV__ = dev;
    launchArguments.value = value;
  });

  it('lets the update screens hold release builds', () => {
    (global as any).__DEV__ = false;
    expect(isUpdateGateEnabled()).toBe(true);
  });

  it('keeps them out of development builds', () => {
    (global as any).__DEV__ = true;
    expect(isUpdateGateEnabled()).toBe(false);
  });

  it('keeps them out of Detox runs, which launch release builds numbered 1', () => {
    (global as any).__DEV__ = false;
    launchArguments.value = () => ({ detoxE2E: true });
    expect(isUpdateGateEnabled()).toBe(false);
  });
});
