/**
 * Let's keep config vars, constants and definitions here
 */

/**
 * Mainnet's BIP-352 activation height, May 8, 2024 when BIP-352 was merged. Each network carries
 * its own floor (`bip352ActivationHeight` in `modules/network.ts`); this is mainnet's, not a
 * default for the others.
 */
export const BIP352_ACTIVATION_HEIGHT = 842579;

/**
 * A birth height is only meaningful between the chain's BIP-352 floor and the current chain tip.
 * The floor is the caller's network's, never a global: clamping a testnet4 height (tip ~150k) up
 * to mainnet's 842579 would put the birth height past the tip and scan nothing.
 */
export const clampBirthHeight = (height: number, tipHeight: number, floor: number): number => Math.min(Math.max(height, floor), tipHeight);
