/**
 * GHL OAuth Token Encryption
 *
 * Uses shared AES-256-CBC encryption with GHL_ENCRYPTION_KEY.
 * Encrypts access and refresh tokens before storing in database,
 * decrypts after reading. Transparent to the rest of the codebase.
 */

import { encrypt, decrypt, resolveKey } from './encryption'

const ENV_KEY = 'GHL_ENCRYPTION_KEY'

export function encryptGhlToken(plaintext: string): string {
  return encrypt(plaintext, resolveKey(ENV_KEY))
}

export function decryptGhlToken(encrypted: string): string {
  return decrypt(encrypted, resolveKey(ENV_KEY))
}

/**
 * Check if a value looks like it's already encrypted (IV:data hex format).
 * Used for safe migration — avoids double-encrypting existing values.
 */
export function isEncrypted(value: string): boolean {
  return /^[0-9a-f]{32}:[0-9a-f]+$/i.test(value)
}
