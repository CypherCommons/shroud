import DefaultPreference from 'react-native-default-preference';
import {
  getIndexerConfig,
  getIndexerPreference,
  hydrateIndexerPreferences,
  normalizeIndexerUrl,
  saveIndexerPreference,
} from '../../modules/indexerPreference';
import { getNetwork } from '../../modules/network';

jest.mock('../../modules/currency', () => ({ GROUP_IO_SHROUD: 'group.com.shroudwallet.app' }));

beforeEach(async () => {
  await saveIndexerPreference('bitcoin');
  await saveIndexerPreference('signet');
});

it('persists each network separately and restores its custom endpoint on startup', async () => {
  await saveIndexerPreference('bitcoin', { baseUrl: ' https://mainnet.example/ ' });
  await saveIndexerPreference('signet', { baseUrl: 'https://signet.example', onionUrl: 'http://signet.onion/' });
  await hydrateIndexerPreferences();
  expect(getIndexerPreference('bitcoin')).toEqual({ baseUrl: 'https://mainnet.example', onionUrl: undefined });
  expect(getIndexerPreference('signet')?.onionUrl).toBe('http://signet.onion');
  expect(getIndexerConfig('bitcoin').fallback?.baseUrl).toBe(getNetwork('bitcoin').indexerBaseUrl);
  expect(getIndexerConfig('bitcoin').onionUrl).toBeUndefined();
});

it('restores the defaults when a custom preference is removed', async () => {
  await saveIndexerPreference('bitcoin', { baseUrl: 'https://custom.example' });
  await saveIndexerPreference('bitcoin');
  expect(getIndexerConfig('bitcoin').baseUrl).toBe(getNetwork('bitcoin').indexerBaseUrl);
  expect(getIndexerConfig('bitcoin').fallback).toBeUndefined();
});

it('uses the default for a corrupt stored preference', async () => {
  await DefaultPreference.set('IndexerPreference_bitcoin', '{broken');
  await hydrateIndexerPreferences();
  expect(getIndexerPreference('bitcoin')).toBeUndefined();
});

it.each(['ftp://host', 'https://user:password@host', 'https://host/?token=secret', 'https://host/#fragment', 'http://host.onion', 'bad'])(
  'rejects invalid clearnet URL %s',
  url => {
    expect(() => normalizeIndexerUrl(url)).toThrow();
  },
);

it('allows local HTTP indexers and requires plain HTTP for onion URLs', () => {
  expect(normalizeIndexerUrl('http://192.168.1.2:8080/api/')).toBe('http://192.168.1.2:8080/api');
  expect(() => normalizeIndexerUrl('https://host.onion', true)).toThrow();
  expect(() => normalizeIndexerUrl('http://clearnet.example', true)).toThrow();
});
