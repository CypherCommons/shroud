import assert from 'assert';

import { completeMnemonicWord, isMnemonicWord, isMnemonicWordPrefix, suggestMnemonicWords } from '../../modules/mnemonicWords';

// Words as a keyboard types them: composed (NFC), while bip39 stores its lists decomposed (NFKD).
const SPANISH_PHRASE = 'detalle árido mismo luna bufanda borrar alga duro detalle árido mismo luz'.normalize('NFC').split(' ');

describe('modules/mnemonicWords', () => {
  it('recognises words from every supported wordlist, however they were typed', () => {
    assert.strictEqual(isMnemonicWord('abandon'), true);
    assert.strictEqual(isMnemonicWord('Abandon'), true);
    assert.strictEqual(isMnemonicWord('sélectif'.normalize('NFC')), true);
    assert.strictEqual(isMnemonicWord('ábaco'.normalize('NFC')), true);
    assert.strictEqual(isMnemonicWord('aban'), false);
    assert.strictEqual(isMnemonicWord(''), false);
  });

  it('tells a word still being typed from one that can never be a word', () => {
    assert.strictEqual(isMnemonicWordPrefix('aba'), true);
    assert.strictEqual(isMnemonicWordPrefix('sél'.normalize('NFC')), true);
    assert.strictEqual(isMnemonicWordPrefix('poil'), false);
  });

  it('suggests words in alphabetical order, capped at the limit', () => {
    assert.deepStrictEqual(suggestMnemonicWords('ab', [], 4), ['abandon', 'ability', 'able', 'about']);
    assert.deepStrictEqual(suggestMnemonicWords('act', [], 8), ['act', 'action', 'actor', 'actress', 'actual']);
    assert.deepStrictEqual(suggestMnemonicWords('', [], 8), []);
    assert.deepStrictEqual(suggestMnemonicWords('poil', [], 8), []);
  });

  it("suggests from the wordlist the rest of the phrase is in, so a Spanish phrase isn't offered English words", () => {
    assert.deepStrictEqual(suggestMnemonicWords('deta', [], 8), ['detail']);
    assert.deepStrictEqual(suggestMnemonicWords('deta', SPANISH_PHRASE, 8), ['detalle']);
  });

  it('completes a prefix only one word can finish', () => {
    assert.strictEqual(completeMnemonicWord('aba', []), 'abandon');
    assert.strictEqual(completeMnemonicWord('acti', []), 'action');
    assert.strictEqual(completeMnemonicWord('deta', SPANISH_PHRASE), 'detalle');
    // Too short to trust, ambiguous, already a word, or no word at all.
    assert.strictEqual(completeMnemonicWord('ya', []), undefined);
    assert.strictEqual(completeMnemonicWord('abs', []), undefined);
    assert.strictEqual(completeMnemonicWord('act', []), undefined);
    assert.strictEqual(completeMnemonicWord('poil', []), undefined);
    // A complete word of another wordlist isn't rewritten into an English one.
    assert.strictEqual(completeMnemonicWord('luna', []), undefined);
  });
});
