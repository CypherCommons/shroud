import assert from 'assert';

import { hasWordBreak, mnemonicWords, mnemonicWordsAsTyped, normalizeMnemonic } from '../../modules/bip39';

describe('modules/bip39 phrase text', () => {
  it('finds word breaks the same way normalizeMnemonic splits words', () => {
    assert.strictEqual(hasWordBreak('abandon'), false);
    assert.strictEqual(hasWordBreak('sélectif'.normalize('NFC')), false);
    assert.strictEqual(hasWordBreak('abandon '), true);
    assert.strictEqual(hasWordBreak('abandon,about'), true);
    assert.strictEqual(hasWordBreak('あいこくしん\u3000'), true);
  });

  it('splits text into words with or without completing them', () => {
    assert.deepStrictEqual(mnemonicWordsAsTyped('  Zoo, ZOO\taban '), ['zoo', 'zoo', 'aban']);
    assert.deepStrictEqual(mnemonicWords('  Zoo, ZOO\taban '), ['zoo', 'zoo', 'abandon']);
    assert.deepStrictEqual(mnemonicWordsAsTyped(' '), []);
    assert.deepStrictEqual(mnemonicWords(' '), []);
  });

  it('drops the numbers of a numbered phrase', () => {
    const phrase = [...Array(11).fill('abandon'), 'about'];
    const numbered = (format: (n: number) => string, separator: string) =>
      phrase.map((word, i) => `${format(i + 1)}${word}`).join(separator);

    assert.deepStrictEqual(mnemonicWords(numbered(n => `${n}. `, '\n')), phrase);
    assert.deepStrictEqual(mnemonicWords(numbered(n => `${n}) `, ' ')), phrase);
    assert.deepStrictEqual(mnemonicWords(numbered(n => `${n}.`, ' ')), phrase);
    assert.deepStrictEqual(mnemonicWordsAsTyped('1. aban 2. zoo'), ['aban', 'zoo']);
    assert.strictEqual(normalizeMnemonic(numbered(n => `${n}. `, '\n')), phrase.join(' '));
  });

  it('decodes a standard SeedQR', () => {
    assert.strictEqual(normalizeMnemonic('0000'.repeat(11) + '0003'), 'abandon '.repeat(11) + 'about');
  });
});
