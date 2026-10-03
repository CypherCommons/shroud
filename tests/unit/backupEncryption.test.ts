import { decryptBackup, encryptBackup } from '../../modules/backupEncryption';

describe('backupEncryption', () => {
  const data = JSON.stringify({ wallets: ['{"secret":"abandon abandon about"}'], tx_metadata: {}, contacts: {} });

  it('round-trips data with the right password', async () => {
    const file = await encryptBackup(data, 'correct horse');
    expect(await decryptBackup(file, 'correct horse')).toBe(data);
  });

  it('returns null for a wrong password', async () => {
    const file = await encryptBackup(data, 'correct horse');
    expect(await decryptBackup(file, 'wrong horse')).toBeNull();
  });

  it('returns null when the ciphertext was modified', async () => {
    const file = JSON.parse(await encryptBackup(data, 'correct horse'));
    const ciphertext = Buffer.from(file.ciphertext, 'base64');
    ciphertext[0] = (ciphertext[0] + 1) % 256;
    file.ciphertext = ciphertext.toString('base64');
    expect(await decryptBackup(JSON.stringify(file), 'correct horse')).toBeNull();
  });

  it('derives the key with scrypt and a fresh salt and IV per file, and never stores the plaintext', async () => {
    const a = JSON.parse(await encryptBackup(data, 'correct horse'));
    const b = JSON.parse(await encryptBackup(data, 'correct horse'));
    expect(a.kdf).toMatchObject({ name: 'scrypt', N: 2 ** 16, r: 8, p: 1 });
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(JSON.stringify(a)).not.toContain('abandon');
  });
});
