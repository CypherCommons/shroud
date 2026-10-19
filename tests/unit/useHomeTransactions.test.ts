import { renderHook } from '@testing-library/react-native';

import { useStorage } from '../../hooks/context/useStorage';
import { useHomeTransactions } from '../../hooks/useHomeTransactions';

jest.mock('../../hooks/context/useStorage');

const mockUseStorage = useStorage as jest.Mock;

describe('unit - useHomeTransactions', () => {
  const getTransactions = jest.fn(() => [{ hash: 'a', value: 1000, inputs: [], outputs: [] }]);

  const mount = (wallets: object[]) => {
    mockUseStorage.mockReturnValue({ wallets, getTransactions });
    return renderHook(() => useHomeTransactions());
  };

  beforeEach(() => getTransactions.mockClear());

  it('keeps the same list across re-renders while the wallets stay the same', () => {
    const { result, rerender } = mount([{}]);
    const first = result.current;

    rerender({});
    rerender({});

    expect(result.current).toBe(first);
    expect(getTransactions).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the list when the wallets change', () => {
    const { result, rerender } = mount([{}]);
    const first = result.current;

    mockUseStorage.mockReturnValue({ wallets: [{}], getTransactions });
    rerender({});

    expect(result.current).not.toBe(first);
    expect(getTransactions).toHaveBeenCalledTimes(2);
  });
});
