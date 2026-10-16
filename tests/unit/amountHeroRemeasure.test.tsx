import { act, renderHook } from '@testing-library/react-native';

import { useRemeasureOnProgrammaticChange } from '../../components/AmountHero';

const renderRemeasure = (value: string, enabled = true) =>
  renderHook((props: { value: string; enabled: boolean }) => useRemeasureOnProgrammaticChange(props.value, props.enabled), {
    initialProps: { value, enabled },
  });

describe('unit - useRemeasureOnProgrammaticChange', () => {
  it('forces a new measurement when the value is set in code', () => {
    const { result, rerender } = renderRemeasure('1234');
    const before = result.current.remeasureStyle;

    rerender({ value: '0.00001234', enabled: true });
    expect(result.current.remeasureStyle).not.toBe(before);

    // back to text that was typed earlier is still a value set in code
    const switched = result.current.remeasureStyle;
    rerender({ value: '1234', enabled: true });
    expect(result.current.remeasureStyle).not.toBe(switched);
  });

  it('leaves typing alone', () => {
    const { result, rerender } = renderRemeasure('123');
    const before = result.current.remeasureStyle;

    act(() => result.current.markTyped('1234'));
    rerender({ value: '1234', enabled: true });
    expect(result.current.remeasureStyle).toBe(before);
  });

  it('does not let a rejected keystroke vouch for a later value set in code', () => {
    const { result, rerender } = renderRemeasure('1234');
    const before = result.current.remeasureStyle;

    // the parent drops the "." and keeps the value, so only an unrelated render follows
    act(() => result.current.markTyped('1234.'));
    rerender({ value: '1234', enabled: true });
    expect(result.current.remeasureStyle).toBe(before);

    rerender({ value: '1234.', enabled: true });
    expect(result.current.remeasureStyle).not.toBe(before);
  });

  it('does nothing when disabled', () => {
    const { result, rerender } = renderRemeasure('1234', false);
    const before = result.current.remeasureStyle;

    rerender({ value: '0.00001234', enabled: false });
    expect(result.current.remeasureStyle).toBe(before);
  });
});
