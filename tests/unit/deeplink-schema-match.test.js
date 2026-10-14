import assert from 'assert';

import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';

jest.mock('../../modules/Electrum', () => {
  const actual = jest.requireActual('../../modules/Electrum');
  return {
    ...actual,
    connectMain: jest.fn(),
  };
});

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

  it('isBitcoin Address', () => {
    assert.ok(DeeplinkSchemaMatch.isBitcoinAddress('12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG'));
    assert.ok(DeeplinkSchemaMatch.isBitcoinAddress('3GcKN7q7gZuZ8eHygAhHrvPa5zZbG5Q1rK'));
    assert.ok(DeeplinkSchemaMatch.isBitcoinAddress('bc1qykcp2x3djgdtdwelxn9z4j2y956npte0a4sref'));
    assert.ok(DeeplinkSchemaMatch.isBitcoinAddress('BC1QYKCP2X3DJGDTDWELXN9Z4J2Y956NPTE0A4SREF'));
    assert.ok(DeeplinkSchemaMatch.isBitcoinAddress(`bitcoin:${suffix}BC1QH6TF004TY7Z7UN2V5NTU4MKF630545GVHS45U7`));
    assert.ok(DeeplinkSchemaMatch.isBitcoinAddress(`BITCOIN:${suffix}BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE`));
    assert.ok(DeeplinkSchemaMatch.isBitcoinAddress(`BITCOIN:${suffix}BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE?amount=666&label=Yo`));
  });

  it('sends payment input to SendDetails', () => {
    const cases = [
      { input: '12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG', expected: '12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG' },
      { input: `bitcoin:${suffix}12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG`, expected: 'bitcoin:12eQ9m4sgAwTSQoNXkRABKhCXCsjm2jdVG' },
      {
        input: `BITCOIN:${suffix}BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE?amount=666&label=Yo`,
        expected: 'BITCOIN:BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE?amount=666&label=Yo',
      },
      {
        input: `shroud:BITCOIN:${suffix}BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE?amount=666&label=Yo`,
        expected: 'BITCOIN:BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE?amount=666&label=Yo',
      },
    ];
    for (const { input, expected } of cases) {
      assert.deepStrictEqual(DeeplinkSchemaMatch.destinationFor(input), { send: expected }, input);
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
      '',
      '   ',
      'shroud:setelectrumserver',
      'shroud:setelectrumserver?server=nonsense',
      'shroud:setelectrumserver?server=%E0%A4%A',
    ];
    for (const input of inputs) {
      assert.deepStrictEqual(DeeplinkSchemaMatch.destinationFor(input), { error: 'unrecognized' }, input);
    }
  });
});
