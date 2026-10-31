import * as Electrum from '../../modules/Electrum';
import NetworkTransactionFees from '../../models/networkTransactionFees';

// blockchain.estimatefee replies in BTC per kvB, keyed here by confirmation target
const mockEstimates: Record<number, number | null> = {};
let mockHistogram: number[][] | null = null;

jest.mock('electrum-client', () =>
  jest.fn().mockImplementation(() => ({
    initElectrum: jest.fn(async () => ['Fulcrum 1.11.0', '1.4']),
    blockchainHeaders_subscribe: jest.fn(async () => ({ height: 900000, hex: '00' })),
    mempool_getFeeHistogram: jest.fn(async () => mockHistogram),
    blockchainEstimatefee: jest.fn(async (numberOfBlocks: number) => mockEstimates[numberOfBlocks]),
    close: jest.fn(),
  })),
);

describe('Electrum fee estimates', () => {
  beforeAll(async () => {
    await Electrum.connectMain();
  });

  beforeEach(() => {
    mockHistogram = null;
  });

  it('converts BTC/kvB to sat/vB using 1000 vbytes per kvB', async () => {
    mockEstimates[1] = 0.0005;
    expect(await Electrum.estimateFee(1)).toBe(50);
  });

  it('never rounds an estimate below 1 sat/vB', async () => {
    mockEstimates[1] = 0.000004;
    expect(await Electrum.estimateFee(1)).toBe(1);
  });

  it('treats a missing or zero estimate like -1', async () => {
    for (const reply of [-1, 0, null]) {
      mockEstimates[1] = reply;
      expect(await Electrum.estimateFee(1)).toBe(1);
    }
  });

  // Bitcoin Core 29.1+ estimates below 1 sat/vB in a quiet mempool, which used to round to 0
  describe('with sub-sat core estimates', () => {
    beforeEach(() => {
      mockEstimates[1] = 0.000004;
      mockEstimates[18] = 0.000002;
      mockEstimates[144] = 0.000001;
    });

    it('does not recommend a 0 sat/vB slow fee when falling back to core estimates', async () => {
      const fees = await NetworkTransactionFees.recommendedFees();
      expect(fees.slowFee).toBe(1);
      expect(fees.mediumFee).toBe(3);
    });

    it('does not produce NaN medium and slow fees from the mempool histogram', async () => {
      mockHistogram = [
        [3, 500000],
        [1, 600000],
      ];
      const fees = await Electrum.estimateFees();
      expect(Number.isFinite(fees.medium)).toBe(true);
      expect(Number.isFinite(fees.slow)).toBe(true);
      expect(fees.slow).toBeGreaterThanOrEqual(1);
    });
  });
});
