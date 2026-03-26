/**
 * GHL Token Store
 *
 * Handles persistent storage and retrieval of GHL OAuth tokens.
 * GHL refresh tokens are single-use - after each refresh, a new
 * refresh token is returned and must be stored.
 *
 * @module dm-sync/lib/ghl-token-store
 */

import { db, eq } from '@0ne/db/server'
import { dmSyncConfig } from '@0ne/db/server'
import { encryptGhlToken, decryptGhlToken, isEncrypted } from '@/lib/ghl-encryption'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Stored token data
 */
export interface StoredTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

/**
 * Token update data
 */
export interface TokenUpdate {
  accessToken: string
  refreshToken: string
  expiresIn: number // seconds until expiry
}

// =============================================================================
// TOKEN STORE FUNCTIONS
// =============================================================================

/**
 * Get stored GHL tokens for a user
 *
 * Falls back to environment variables if no tokens stored in database.
 * This allows for initial setup via env vars, then automatic rotation.
 *
 * @param userId - The user ID
 * @returns Stored tokens or null if not found
 */
export async function getStoredTokens(
  userId: string
): Promise<StoredTokens | null> {
  const [data] = await db.select({
    ghlAccessToken: dmSyncConfig.ghlAccessToken,
    ghlRefreshToken: dmSyncConfig.ghlRefreshToken,
    ghlTokenExpiresAt: dmSyncConfig.ghlTokenExpiresAt,
  }).from(dmSyncConfig)
    .where(eq(dmSyncConfig.clerkUserId, userId))
    .limit(1)

  if (!data) {
    console.log(`[GHL Token Store] No config found for user: ${userId}`)
    return null
  }

  // Check if tokens exist in database
  if (data.ghlRefreshToken) {
    console.log('[GHL Token Store] Using tokens from database')
    // Decrypt tokens — handles both encrypted and legacy plaintext values
    const rawAccess = data.ghlAccessToken || ''
    const rawRefresh = data.ghlRefreshToken
    return {
      accessToken: rawAccess && isEncrypted(rawAccess) ? decryptGhlToken(rawAccess) : rawAccess,
      refreshToken: isEncrypted(rawRefresh) ? decryptGhlToken(rawRefresh) : rawRefresh,
      expiresAt: data.ghlTokenExpiresAt
        ? new Date(data.ghlTokenExpiresAt)
        : new Date(0),
    }
  }

  // Fall back to environment variables (initial setup)
  const envAccessToken = process.env.GHL_MARKETPLACE_ACCESS_TOKEN
  const envRefreshToken = process.env.GHL_MARKETPLACE_REFRESH_TOKEN
  const envExpiresAt = process.env.GHL_MARKETPLACE_TOKEN_EXPIRES

  if (envRefreshToken) {
    console.log('[GHL Token Store] Using tokens from environment (will migrate to DB on next refresh)')
    return {
      accessToken: envAccessToken || '',
      refreshToken: envRefreshToken,
      expiresAt: envExpiresAt ? new Date(parseInt(envExpiresAt)) : new Date(0),
    }
  }

  console.log('[GHL Token Store] No tokens found in database or environment')
  return null
}

/**
 * Save updated GHL tokens to database
 *
 * This is called after each token refresh to persist the new tokens.
 * CRITICAL: GHL refresh tokens are single-use, so we must save the
 * new refresh token or it will be lost.
 *
 * @param userId - The user ID
 * @param tokens - The new token data
 */
export async function saveTokens(
  userId: string,
  tokens: TokenUpdate
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000)

  console.log('[GHL Token Store] Saving new tokens to database', {
    userId,
    accessTokenLength: tokens.accessToken.length,
    refreshTokenLength: tokens.refreshToken.length,
    expiresAt: expiresAt.toISOString(),
  })

  try {
    await db.update(dmSyncConfig)
      .set({
        ghlAccessToken: encryptGhlToken(tokens.accessToken),
        ghlRefreshToken: encryptGhlToken(tokens.refreshToken),
        ghlTokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(dmSyncConfig.clerkUserId, userId))
  } catch (error) {
    console.error('[GHL Token Store] Failed to save tokens:', String(error))
    throw new Error(`Failed to save GHL tokens: ${String(error)}`)
  }

  console.log('[GHL Token Store] Tokens saved successfully')
}

/**
 * Check if stored tokens are expired or about to expire
 *
 * @param tokens - The stored tokens
 * @param bufferMs - Buffer time in milliseconds (default 5 minutes)
 * @returns true if tokens need refresh
 */
export function tokensNeedRefresh(
  tokens: StoredTokens,
  bufferMs: number = 5 * 60 * 1000
): boolean {
  return tokens.expiresAt.getTime() < Date.now() + bufferMs
}

/**
 * Clear stored tokens for a user
 *
 * Use this when tokens become invalid and user needs to re-authorize.
 *
 * @param userId - The user ID
 */
export async function clearTokens(userId: string): Promise<void> {
  try {
    await db.update(dmSyncConfig)
      .set({
        ghlAccessToken: null,
        ghlRefreshToken: null,
        ghlTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(dmSyncConfig.clerkUserId, userId))
  } catch (error) {
    console.error('[GHL Token Store] Failed to clear tokens:', String(error))
    throw new Error(`Failed to clear GHL tokens: ${String(error)}`)
  }

  console.log('[GHL Token Store] Tokens cleared for user:', userId)
}
