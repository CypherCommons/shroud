import { webcrypto } from 'crypto';
import { nobleSubtle } from '../../helpers/chat/nobleSubtle';
import { runChatSelfTest } from '../../helpers/chat/selfTest';

describe('chat self-test (Appendix B flow)', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  beforeAll(() => {
    // Remove WebCrypto's subtle so the run proves marmot-ts works on the noble shim alone, as on Hermes.
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      writable: true,
      value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: nobleSubtle },
    });
  });

  afterAll(() => {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
  });

  it('runs key package → group → invite → join → chat → notice → receipt', async () => {
    const result = await runChatSelfTest();
    const failed = result.steps.find(s => !s.ok);
    expect(failed).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.steps.length).toBeGreaterThanOrEqual(10);
  }, 60000);
});
