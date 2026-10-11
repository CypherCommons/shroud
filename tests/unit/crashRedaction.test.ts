import assert from 'assert';

import { REDACTED, installCrashRedaction, redact, redactError } from '../../modules/crashRedaction';

const TXID = 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16';
const SECRETS = {
  txid: TXID,
  segwit: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  taproot: 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297',
  testnet: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
  silentPayment: 'sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv',
  p2pkh: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
  p2sh: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
  xpub: 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8',
  wif: '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ',
};

describe('unit - crash report redaction', () => {
  for (const [kind, secret] of Object.entries(SECRETS)) {
    it(`removes a ${kind} from error text`, () => {
      const text = redact(`Error fetching ${secret}: timeout`);
      assert.strictEqual(text, `Error fetching ${REDACTED}: timeout`);
    });
  }

  it('leaves ordinary messages and stack frames alone', () => {
    const text = "TypeError: undefined is not an object (evaluating 'wallet.getBalance')\n    at fetchTx (index.android.bundle:1:23456)";
    assert.strictEqual(redact(text), text);
  });

  it('scrubs the message and the stack of an Error', () => {
    const error = new Error(`Error fetching transaction by txid ${TXID}`);
    const result = redactError(error) as Error;
    assert.strictEqual(result, error);
    assert.strictEqual(result.message, `Error fetching transaction by txid ${REDACTED}`);
    assert.ok(!String(result.stack).includes(TXID));
  });

  it('reports a scrubbed copy of a frozen Error', () => {
    const error = Object.freeze(new Error(`bad address ${SECRETS.segwit}`));
    const result = redactError(error) as Error;
    assert.notStrictEqual(result, error);
    assert.strictEqual(result.message, `bad address ${REDACTED}`);
  });

  it('scrubs thrown strings and passes other values through', () => {
    assert.strictEqual(redactError(`txid ${TXID}`), `txid ${REDACTED}`);
    const value = { code: 42 };
    assert.strictEqual(redactError(value), value);
  });

  it('wraps the global error handler and keeps the fatal flag', () => {
    const previous = jest.fn();
    let installed: ((error: unknown, isFatal?: boolean) => void) | undefined;
    installCrashRedaction({ getGlobalHandler: () => previous, setGlobalHandler: handler => (installed = handler) });

    installed?.(new Error(`lookup ${TXID}`), true);
    expect(previous).toHaveBeenCalledTimes(1);
    const [error, isFatal] = previous.mock.calls[0];
    assert.strictEqual((error as Error).message, `lookup ${REDACTED}`);
    assert.strictEqual(isFatal, true);
  });
});
