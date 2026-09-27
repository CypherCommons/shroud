import assert from 'assert';

import { getEffectiveTheme, ShroudDefaultTheme, ShroudDarkTheme } from '../../components/themes';

describe('unit - getEffectiveTheme', () => {
  it('follows the OS color scheme when preference is system', () => {
    assert.strictEqual(getEffectiveTheme('system', 'dark'), ShroudDarkTheme);
    assert.strictEqual(getEffectiveTheme('system', 'light'), ShroudDefaultTheme);
  });

  it('falls back to the default theme when preference is system and the OS scheme is unknown', () => {
    assert.strictEqual(getEffectiveTheme('system', 'unspecified'), ShroudDefaultTheme);
  });

  it('forces the light theme regardless of a dark OS color scheme', () => {
    assert.strictEqual(getEffectiveTheme('light', 'dark'), ShroudDefaultTheme);
  });

  it('forces the dark theme regardless of a light OS color scheme', () => {
    assert.strictEqual(getEffectiveTheme('dark', 'light'), ShroudDarkTheme);
  });
});
