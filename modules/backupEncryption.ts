import AES from 'crypto-js/aes';
import Hex from 'crypto-js/enc-hex';
import Utf8 from 'crypto-js/enc-utf8';
import { hmac } from '@noble/hashes/hmac';
import { scryptAsync } from '@noble/hashes/scrypt';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '../class/rng';

// Encryption for wallet backup files. Unlike modules/encryption (CryptoJS's password mode, one MD5 round
// to derive the key), the key comes from scrypt, so guessing the password of a leaked file is slow.

// 64 MiB of memory per guess. Stored in each file, so it can be raised later without breaking old files.
const SCRYPT_PARAMS = { N: 2 ** 16, r: 8, p: 1 };

interface BackupFile {
  version: 1;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
  cipher: 'aes-256-cbc';
  iv: string;
  ciphertext: string;
  /** HMAC-SHA256 over iv + ciphertext, so a wrong password or a modified file is detected. */
  mac: string;
}

// 64 bytes from scrypt: the first half is the AES key, the second the HMAC key.
const deriveKeys = async (password: string, salt: Buffer, params: typeof SCRYPT_PARAMS) => {
  const derived = Buffer.from(await scryptAsync(password, salt, { ...params, dkLen: 64 }));
  return { encKey: derived.subarray(0, 32), macKey: derived.subarray(32) };
};

const computeMac = (macKey: Buffer, iv: Buffer, ciphertext: Buffer): Buffer =>
  Buffer.from(hmac(sha256, macKey, Buffer.concat([iv, ciphertext])));

export const encryptBackup = async (data: string, password: string): Promise<string> => {
  const salt = await randomBytes(16);
  const iv = await randomBytes(16);
  const { encKey, macKey } = await deriveKeys(password, salt, SCRYPT_PARAMS);

  const encrypted = AES.encrypt(Utf8.parse(data), Hex.parse(encKey.toString('hex')), { iv: Hex.parse(iv.toString('hex')) });
  const ciphertext = Buffer.from(encrypted.ciphertext.toString(Hex), 'hex');

  const file: BackupFile = {
    version: 1,
    kdf: { name: 'scrypt', ...SCRYPT_PARAMS, salt: salt.toString('hex') },
    cipher: 'aes-256-cbc',
    iv: iv.toString('hex'),
    ciphertext: ciphertext.toString('base64'),
    mac: computeMac(macKey, iv, ciphertext).toString('hex'),
  };
  return JSON.stringify(file);
};

/** Returns the plaintext, or null when the password is wrong or the file was modified. */
export const decryptBackup = async (fileContents: string, password: string): Promise<string | null> => {
  const file: BackupFile = JSON.parse(fileContents);
  if (file.version !== 1 || file.kdf.name !== 'scrypt' || file.cipher !== 'aes-256-cbc') {
    throw new Error('Unsupported backup file format');
  }
  const { N, r, p, salt } = file.kdf;
  const iv = Buffer.from(file.iv, 'hex');
  const ciphertext = Buffer.from(file.ciphertext, 'base64');
  const { encKey, macKey } = await deriveKeys(password, Buffer.from(salt, 'hex'), { N, r, p });

  if (!computeMac(macKey, iv, ciphertext).equals(Buffer.from(file.mac, 'hex'))) return null;

  const decrypted = AES.decrypt(file.ciphertext, Hex.parse(encKey.toString('hex')), { iv: Hex.parse(file.iv) });
  return decrypted.toString(Utf8);
};
