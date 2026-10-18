import { readFileSync } from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { UPDATE_SERVER_URL } from '../../constants/links';
import { isUpdateRequired, parseBuildNumber, parseUpdatePolicy, resolvePolicy } from '../../modules/updatePolicy';
import { fetch } from '../../util/fetch';

jest.mock('../../util/fetch');
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

const respond = (status: number, json: () => Promise<unknown> = async () => undefined) => ({ status, json }) as unknown as Response;
const saved = () => AsyncStorage.getItem('UpdatePolicy');

describe('unit - updatePolicy', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockFetch.mockReset();
  });

  it('reads the policy from the server the native config and the publish scripts point at', () => {
    expect(`${UPDATE_SERVER_URL}/manifest`).toBe(require('../../app.json').expo.updates.url);
    // scripts/ota/lib.mjs is an ES module, so read its constant rather than import it.
    const lib = readFileSync(path.join(__dirname, '../../scripts/ota/lib.mjs'), 'utf8');
    expect(lib).toContain(`export const DEFAULT_BASE_URL = '${UPDATE_SERVER_URL}';`);
  });

  describe('parseUpdatePolicy', () => {
    it('keeps the minimum of each platform that has one', () => {
      expect(parseUpdatePolicy({ minimumBuild: { ios: 12, android: 0 }, updatedAt: '2026-10-16T00:00:00.000Z' })).toEqual({
        minimumBuild: { ios: 12, android: 0 },
      });
      expect(parseUpdatePolicy({ minimumBuild: { android: 7 } })).toEqual({ minimumBuild: { android: 7 } });
      expect(parseUpdatePolicy({ minimumBuild: {}, future: true })).toEqual({ minimumBuild: {} });
    });

    it.each([
      ['a non-object', 'nope'],
      ['null', null],
      ['no minimumBuild', {}],
      ['a non-object minimumBuild', { minimumBuild: 12 }],
      ['a numeric string', { minimumBuild: { ios: '12' } }],
      ['a fraction', { minimumBuild: { ios: 12.5 } }],
      ['a negative build', { minimumBuild: { android: -1 } }],
      ['null for a platform', { minimumBuild: { ios: null } }],
      ['a malformed entry next to a valid one', { minimumBuild: { ios: 12, android: 'x' } }],
    ])('rejects %s', (_, value) => {
      expect(parseUpdatePolicy(value)).toBeNull();
    });
  });

  it('reads plain integer build numbers only', () => {
    expect(parseBuildNumber('42')).toBe(42);
    expect(parseBuildNumber('0')).toBe(0);
    expect(parseBuildNumber('')).toBeNull();
    expect(parseBuildNumber('1.2.3')).toBeNull();
    expect(parseBuildNumber('unknown')).toBeNull();
  });

  it('blocks only builds below their own platform minimum', () => {
    const policy = { minimumBuild: { ios: 10, android: 0 } };
    expect(isUpdateRequired(policy, 'ios', 9)).toBe(true);
    expect(isUpdateRequired(policy, 'ios', 10)).toBe(false);
    expect(isUpdateRequired(policy, 'android', 1)).toBe(false);
    expect(isUpdateRequired({ minimumBuild: { ios: 10 } }, 'android', 1)).toBe(false);
    expect(isUpdateRequired(policy, 'web', 1)).toBe(false);
    expect(isUpdateRequired(policy, 'ios', null)).toBe(false);
    expect(isUpdateRequired(null, 'ios', 1)).toBe(false);
  });

  describe('resolvePolicy', () => {
    const savedPolicy = { minimumBuild: { ios: 3 } };
    const save = () => AsyncStorage.setItem('UpdatePolicy', JSON.stringify(savedPolicy));

    it('hands over the saved policy before the server answers', async () => {
      await save();
      const onSaved = jest.fn();
      let answer: (response: Response) => void = () => {};
      mockFetch.mockReturnValue(new Promise(resolve => (answer = resolve)));

      const resolved = resolvePolicy('production', onSaved);
      await new Promise(setImmediate);
      expect(onSaved).toHaveBeenCalledWith(savedPolicy);

      answer(respond(204));
      await expect(resolved).resolves.toBeNull();
    });

    it('treats nothing saved, or something unreadable, as no policy', async () => {
      const onSaved = jest.fn();
      mockFetch.mockRejectedValue(new Error('Network request failed'));
      await expect(resolvePolicy('production', onSaved)).resolves.toBeNull();
      await AsyncStorage.setItem('UpdatePolicy', '{not json');
      await expect(resolvePolicy('production', onSaved)).resolves.toBeNull();
      expect(onSaved.mock.calls).toEqual([[null], [null]]);
    });

    it("asks for the build's channel, and saves the answer", async () => {
      await save();
      mockFetch.mockResolvedValue(respond(200, async () => ({ minimumBuild: { ios: 5, android: 4 } })));

      await expect(resolvePolicy('preview', () => {})).resolves.toEqual({ minimumBuild: { ios: 5, android: 4 } });
      expect(mockFetch).toHaveBeenCalledWith('https://updates.shroudwallet.com/policy', { headers: { 'expo-channel-name': 'preview' } });
      expect(JSON.parse((await saved())!)).toEqual({ minimumBuild: { ios: 5, android: 4 } });
    });

    it('clears the saved policy when the server has none', async () => {
      await save();
      mockFetch.mockResolvedValue(respond(204));

      await expect(resolvePolicy('production', () => {})).resolves.toBeNull();
      expect(await saved()).toBeNull();
    });

    it.each([
      ['the request fails', () => mockFetch.mockRejectedValue(new Error('Network request failed'))],
      ['the server errors', () => mockFetch.mockResolvedValue(respond(500))],
      ['the server predates /policy', () => mockFetch.mockResolvedValue(respond(404))],
      [
        'the body is not JSON',
        () => mockFetch.mockResolvedValue(respond(200, async () => Promise.reject(new SyntaxError('Unexpected token')))),
      ],
      ['the body is not a policy', () => mockFetch.mockResolvedValue(respond(200, async () => ({ minimumBuild: { ios: '9' } })))],
    ])('keeps the saved policy when %s', async (_, arrange) => {
      await save();
      arrange();

      await expect(resolvePolicy('production', () => {})).resolves.toEqual(savedPolicy);
      expect(JSON.parse((await saved())!)).toEqual(savedPolicy);
    });
  });
});
