import assert from 'assert';

import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import { DEFAULT_NETWORK_ID, setActiveNetwork } from '../../modules/network';
import { SP_MAINNET, SP_MAINNET_2, SP_SIGNET } from '../fixtures/addresses';

jest.mock('../../modules/Electrum', () => {
  const actual = jest.requireActual('../../modules/Electrum');
  return {
    ...actual,
    connectMain: jest.fn(),
  };
});

const BECH32_MAINNET = 'bc1qykcp2x3djgdtdwelxn9z4j2y956npte0a4sref';
const BECH32_SIGNET = 'tb1q38gfnkegcnf63cqfef5f6xvk35nywefzknv070';

describe.each(['', '//'])('unit - DeepLinkSchemaMatch', function (suffix) {
  it('hasSchema', () => {
    assert.ok(DeeplinkSchemaMatch.hasSchema(`bitcoin:${suffix}12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG`));
    assert.ok(DeeplinkSchemaMatch.hasSchema(`bitcoin:${suffix}bc1qh6tf004ty7z7un2v5ntu4mkf630545gvhs45u7?amount=666&label=Yo`));
    assert.ok(DeeplinkSchemaMatch.hasSchema(`bitcoin:${suffix}BC1QH6TF004TY7Z7UN2V5NTU4MKF630545GVHS45U7?amount=666&label=Yo`));
    assert.ok(DeeplinkSchemaMatch.hasSchema(`BITCOIN:${suffix}BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE`));
    assert.ok(DeeplinkSchemaMatch.hasSchema(`BITCOIN:${suffix}BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE?amount=666&label=Yo`));

    assert.ok(DeeplinkSchemaMatch.hasSchema(`shroud:bitcoin:${suffix}12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG`));
    assert.ok(DeeplinkSchemaMatch.hasSchema(`shroud:bitcoin:${suffix}bc1qh6tf004ty7z7un2v5ntu4mkf630545gvhs45u7?amount=666&label=Yo`));
    assert.ok(DeeplinkSchemaMatch.hasSchema(`shroud:bitcoin:${suffix}BC1QH6TF004TY7Z7UN2V5NTU4MKF630545GVHS45U7?amount=666&label=Yo`));
    assert.ok(DeeplinkSchemaMatch.hasSchema(`shroud:BITCOIN:${suffix}BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE`));
    assert.ok(DeeplinkSchemaMatch.hasSchema(`shroud:BITCOIN:${suffix}BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE?amount=666&label=Yo`));
  });

  it('sends payment input to SendDetails as a canonical URI', () => {
    const upper = SP_MAINNET.toUpperCase();
    const cases = [
      { input: '12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG', expected: '12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG' },
      { input: '3GcKN7q7gZuZ8eHygAhHrvPa5zZbG5Q1rK', expected: '3GcKN7q7gZuZ8eHygAhHrvPa5zZbG5Q1rK' },
      { input: 'BC1QYKCP2X3DJGDTDWELXN9Z4J2Y956NPTE0A4SREF', expected: 'BC1QYKCP2X3DJGDTDWELXN9Z4J2Y956NPTE0A4SREF' },
      { input: `bitcoin:${suffix}12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG`, expected: 'bitcoin:12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG' },
      { input: `Bitcoin:${suffix}12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG`, expected: 'bitcoin:12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG' },
      {
        input: `BITCOIN:${suffix}BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE?amount=666&label=Yo`,
        expected: 'bitcoin:BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE?amount=666&label=Yo',
      },
      {
        input: `shroud:BITCOIN:${suffix}BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE?amount=666&label=Yo`,
        expected: 'bitcoin:BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE?amount=666&label=Yo',
      },
      {
        input: `bitcoin:${suffix}12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG?label=http://example.com`,
        expected: 'bitcoin:12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG?label=http://example.com',
      },
      { input: SP_MAINNET, expected: SP_MAINNET },
      { input: upper, expected: upper },
      { input: ` ${SP_MAINNET}\n`, expected: SP_MAINNET },
      { input: `bitcoin:${suffix}${SP_MAINNET}?amount=0.001&label=Yo`, expected: `bitcoin:${SP_MAINNET}?amount=0.001&label=Yo` },
      { input: `BITCOIN:${suffix}${upper}`, expected: `bitcoin:${upper}` },
      { input: `shroud:bitcoin:${suffix}${SP_MAINNET}`, expected: `bitcoin:${SP_MAINNET}` },
    ];
    for (const { input, expected } of cases) {
      assert.deepStrictEqual(DeeplinkSchemaMatch.destinationFor(input), { send: expected }, input);
    }
  });

  it('reports addresses from another network', () => {
    for (const input of [SP_SIGNET, BECH32_SIGNET, `bitcoin:${suffix}${SP_SIGNET}?amount=0.001`]) {
      assert.deepStrictEqual(DeeplinkSchemaMatch.destinationFor(input), { error: 'wrong_network' }, input);
    }
  });

  it('decodes bip21', () => {
    let decoded = DeeplinkSchemaMatch.bip21decode(`bitcoin:${suffix}1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH?amount=20.3&label=Foobar`);
    assert.deepStrictEqual(decoded, {
      address: '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH',
      options: {
        amount: 20.3,
        label: 'Foobar',
      },
    });

    decoded = DeeplinkSchemaMatch.bip21decode(`bitcoin:${suffix}bc1qnapskphjnwzw2w3dk4anpxntunc77v6qrua0f7?amount=0.0001`);

    decoded = DeeplinkSchemaMatch.bip21decode(`BITCOIN:${suffix}1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH?amount=20.3&label=Foobar`);
    assert.deepStrictEqual(decoded, {
      address: '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH',
      options: {
        amount: 20.3,
        label: 'Foobar',
      },
    });

    decoded = DeeplinkSchemaMatch.bip21decode(`Bitcoin:${suffix}1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH?label=bitcoin://x`);
    assert.deepStrictEqual(decoded, {
      address: '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH',
      options: {
        label: 'bitcoin://x',
      },
    });
  });

  it('encodes bip21', () => {
    let encoded = DeeplinkSchemaMatch.bip21encode('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH');
    assert.strictEqual(encoded, 'bitcoin:1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH');
    encoded = DeeplinkSchemaMatch.bip21encode('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH', {
      amount: 20.3,
      label: 'Foobar',
    });
    assert.strictEqual(encoded, 'bitcoin:1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH?amount=20.3&label=Foobar');
  });

  it('encodes bip21 and discards empty arguments', () => {
    const encoded = DeeplinkSchemaMatch.bip21encode('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH', {
      label: ' ',
      amoount: undefined,
    });
    assert.strictEqual(encoded, 'bitcoin:1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH');
  });

  it('can decodeBitcoinUri', () => {
    assert.deepStrictEqual(
      DeeplinkSchemaMatch.decodeBitcoinUri(`bitcoin:${suffix}bc1qnapskphjnwzw2w3dk4anpxntunc77v6qrua0f7?amount=0.0001`),
      {
        address: 'bc1qnapskphjnwzw2w3dk4anpxntunc77v6qrua0f7',
        amount: 0.0001,
        memo: '',
      },
    );

    assert.deepStrictEqual(
      DeeplinkSchemaMatch.decodeBitcoinUri(`BITCOIN:${suffix}1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH?amount=20.3&label=Foobar`),
      {
        address: '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH',
        amount: 20.3,
        memo: 'Foobar',
      },
    );
  });

  it('keeps the address of a request bip21 rejects over a malformed amount', () => {
    for (const query of ['amount=abc&label=Foo', 'amount=-1', 'amount[]=x', 'am%6Funt=-1']) {
      const uri = `bitcoin:${suffix}${SP_MAINNET}?${query}`;
      assert.deepStrictEqual(DeeplinkSchemaMatch.decodeBitcoinUri(uri), { address: SP_MAINNET, amount: undefined, memo: '' }, uri);
    }
  });

  it('leaves out a label that qs parsed into an array or an object', () => {
    for (const query of ['label=a&label=b', 'label[a]=b']) {
      const uri = `bitcoin:${suffix}${SP_MAINNET}?amount=0.001&${query}`;
      assert.deepStrictEqual(DeeplinkSchemaMatch.decodeBitcoinUri(uri), { address: SP_MAINNET, amount: 0.001, memo: '' }, uri);
    }
  });

  it('routes a BIP-321 sp= payment link to SendDetails', () => {
    const upper = SP_MAINNET.toUpperCase();
    const cases = [
      { input: `bitcoin:${suffix}?sp=${SP_MAINNET}`, expected: `bitcoin:?sp=${SP_MAINNET}` },
      { input: `bitcoin:${suffix}?amount=0.001&sp=${SP_MAINNET}&label=Yo`, expected: `bitcoin:?amount=0.001&sp=${SP_MAINNET}&label=Yo` },
      { input: `BITCOIN:${suffix}?SP=${upper}`, expected: `bitcoin:?SP=${upper}` },
      { input: `bitcoin:${suffix}${BECH32_MAINNET}?sp=${SP_MAINNET}`, expected: `bitcoin:${BECH32_MAINNET}?sp=${SP_MAINNET}` },
      { input: `shroud:bitcoin:${suffix}?sp=${SP_MAINNET}`, expected: `bitcoin:?sp=${SP_MAINNET}` },
    ];
    for (const { input, expected } of cases) {
      assert.deepStrictEqual(DeeplinkSchemaMatch.destinationFor(input), { send: expected }, input);
    }
  });

  it('reports a BIP-321 sp= for another network', () => {
    assert.deepStrictEqual(DeeplinkSchemaMatch.destinationFor(`bitcoin:${suffix}?sp=${SP_SIGNET}`), { error: 'wrong_network' });
  });

  it('pays the BIP-321 sp= address, keeping amount and label', () => {
    const upper = SP_MAINNET.toUpperCase();
    const cases = [
      { uri: `bitcoin:${suffix}?sp=${SP_MAINNET}`, address: SP_MAINNET, amount: undefined, memo: '' },
      { uri: `bitcoin:${suffix}?sp=${SP_MAINNET}&amount=0.001&label=Yo`, address: SP_MAINNET, amount: 0.001, memo: 'Yo' },
      // the reusable on-chain fallback is not paid when the silent payment address can be
      { uri: `bitcoin:${suffix}${BECH32_MAINNET}?amount=0.001&sp=${SP_MAINNET}`, address: SP_MAINNET, amount: 0.001, memo: '' },
      // BIP-321 query keys are case-insensitive, as in an all-uppercase QR code
      { uri: `BITCOIN:${suffix}?SP=${upper}`, address: upper, amount: undefined, memo: '' },
      // the first sp= valid on this network, when a link offers one per network
      { uri: `bitcoin:${suffix}?sp=${SP_SIGNET}&sp=${SP_MAINNET}&sp=${SP_MAINNET_2}`, address: SP_MAINNET, amount: undefined, memo: '' },
      // a malformed amount still leaves the silent payment address to pay
      { uri: `bitcoin:${suffix}?sp=${SP_MAINNET}&amount=abc`, address: SP_MAINNET, amount: undefined, memo: '' },
    ];
    for (const { uri, ...expected } of cases) {
      assert.deepStrictEqual(DeeplinkSchemaMatch.decodeBitcoinUri(uri), expected, uri);
    }
  });

  it('falls back to the on-chain address when no sp= is usable here', () => {
    for (const sp of [SP_SIGNET, 'sp1nonsense', '%E0%A4%A']) {
      const uri = `bitcoin:${suffix}${BECH32_MAINNET}?amount=0.001&sp=${sp}`;
      assert.deepStrictEqual(DeeplinkSchemaMatch.decodeBitcoinUri(uri), { address: BECH32_MAINNET, amount: 0.001, memo: '' }, uri);
    }
  });

  it('hands back input with no address to fall back to as it came', () => {
    for (const input of ['not an address', `bitcoin:${suffix}?amount=abc`]) {
      assert.deepStrictEqual(DeeplinkSchemaMatch.decodeBitcoinUri(input), { address: input, amount: undefined, memo: '' }, input);
    }
  });

  it('can work with some deeplink actions', () => {
    assert.strictEqual(DeeplinkSchemaMatch.getServerFromSetElectrumServerAction('sgasdgasdgasd'), false);
    assert.deepStrictEqual(
      DeeplinkSchemaMatch.getServerFromSetElectrumServerAction('shroud:setelectrumserver?server=electrum1.bluewallet.io%3A443%3As'),
      { host: 'electrum1.bluewallet.io', ssl: 443 },
    );
    assert.deepStrictEqual(
      DeeplinkSchemaMatch.getServerFromSetElectrumServerAction('setelectrumserver?server=electrum1.bluewallet.io%3A443%3As'),
      { host: 'electrum1.bluewallet.io', ssl: 443 },
    );
    assert.strictEqual(
      DeeplinkSchemaMatch.getServerFromSetElectrumServerAction('ololo:setelectrumserver?server=electrum1.bluewallet.io%3A443%3As'),
      false,
    );
    assert.strictEqual(
      DeeplinkSchemaMatch.getServerFromSetElectrumServerAction('setTrololo?server=electrum1.bluewallet.io%3A443%3As'),
      false,
    );
    assert.strictEqual(DeeplinkSchemaMatch.getServerFromSetElectrumServerAction('shroud:setelectrumserver?server=nonsense'), false);
    assert.strictEqual(DeeplinkSchemaMatch.getServerFromSetElectrumServerAction('shroud:setelectrumserver?server=%E0%A4%A'), false);
  });
});

describe('unit - DeepLinkSchemaMatch.destinationFor', () => {
  it('opens Electrum settings for a setelectrumserver link', () => {
    assert.deepStrictEqual(DeeplinkSchemaMatch.destinationFor('shroud:setelectrumserver?server=electrum1.bluewallet.io%3A443%3As'), {
      electrumServer: { host: 'electrum1.bluewallet.io', ssl: 443 },
    });
  });

  it('reports input it cannot route', () => {
    const inputs = [
      'not-an-address',
      'sp1nonsense',
      '',
      '   ',
      // Not BIP21: on master this opened Send with `bitcoin=…` as the address.
      'bitcoin=12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG',
      // BIP-321 `sp=` that is no silent payment address, or only outside a bitcoin: URI
      'bitcoin:?sp=sp1nonsense',
      'bitcoin:?sp=%E0%A4%A',
      `?sp=${SP_MAINNET}`,
      'shroud:setelectrumserver',
      'shroud:setelectrumserver?server=nonsense',
      'shroud:setelectrumserver?server=%E0%A4%A',
    ];
    for (const input of inputs) {
      assert.deepStrictEqual(DeeplinkSchemaMatch.destinationFor(input), { error: 'unrecognized' }, input);
    }
  });

  describe('on signet', () => {
    beforeEach(() => setActiveNetwork('signet'));
    afterEach(() => setActiveNetwork(DEFAULT_NETWORK_ID));

    it('sends signet addresses to SendDetails', () => {
      for (const input of [SP_SIGNET, SP_SIGNET.toUpperCase(), BECH32_SIGNET, `bitcoin:${SP_SIGNET}?amount=0.001`]) {
        assert.deepStrictEqual(DeeplinkSchemaMatch.destinationFor(input), { send: input }, input);
      }
    });

    it('pays the signet sp= of a link that offers one per network', () => {
      const uri = `bitcoin:?sp=${SP_MAINNET}&sp=${SP_SIGNET}`;
      assert.deepStrictEqual(DeeplinkSchemaMatch.destinationFor(uri), { send: uri });
      assert.deepStrictEqual(DeeplinkSchemaMatch.decodeBitcoinUri(uri), { address: SP_SIGNET, amount: undefined, memo: '' });
    });

    it('reports mainnet addresses as another network', () => {
      for (const input of [SP_MAINNET, BECH32_MAINNET, `bitcoin:?sp=${SP_MAINNET}`]) {
        assert.deepStrictEqual(DeeplinkSchemaMatch.destinationFor(input), { error: 'wrong_network' }, input);
      }
    });
  });
});
