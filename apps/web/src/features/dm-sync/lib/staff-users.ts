/**
 * Staff Users Management
 *
 * Handles multi-staff support for Skool-GHL DM sync.
 * Maps Skool staff members to GHL users for proper message attribution
 * and outbound routing.
 *
 * @module dm-sync/lib/staff-users
 */

import { db, eq, and, asc, desc, isNotNull, ilike } from '@0ne/db/server'
import { staffUsers as staffUsersTable, dmMessages } from '@0ne/db/server'
import type { StaffUserRow } from '../types'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Input for creating/updating a staff user
 */
export interface StaffUserInput {
  userId: string // 0ne-app account owner
  skoolUserId: string
  skoolUsername?: string
  displayName: string
  ghlUserId?: string
  isDefault?: boolean
  isActive?: boolean
}

/**
 * Result from staff resolution
 */
export interface ResolvedStaff {
  skoolUserId: string
  displayName: string
  ghlUserId: string | null
  matchMethod: 'override' | 'ghl_user' | 'last_conversation' | 'default'
}

// =============================================================================
// CRUD OPERATIONS
// =============================================================================

/**
 * Get all staff users for an account
 */
export async function getStaffUsers(userId: string): Promise<StaffUserRow[]> {
  try {
    const data = await db.select().from(staffUsersTable)
      .where(eq(staffUsersTable.clerkUserId, userId))
      .orderBy(asc(staffUsersTable.displayName))

    // as unknown as: bridges Date|null→string (createdAt/updatedAt), boolean|null→boolean (isActive/isDefault), string|null→string (clerkUserId)
    return data as unknown as StaffUserRow[]
  } catch (error) {
    console.error('[Staff Users] Error fetching staff:', error)
    throw new Error(`Failed to fetch staff users: ${String(error)}`)
  }
}

/**
 * Get active staff users for an account
 */
export async function getActiveStaffUsers(userId: string): Promise<StaffUserRow[]> {
  try {
    const data = await db.select().from(staffUsersTable)
      .where(and(eq(staffUsersTable.clerkUserId, userId), eq(staffUsersTable.isActive, true)))
      .orderBy(asc(staffUsersTable.displayName))

    return data as unknown as StaffUserRow[]
  } catch (error) {
    console.error('[Staff Users] Error fetching active staff:', error)
    throw new Error(`Failed to fetch active staff users: ${String(error)}`)
  }
}

/**
 * Get a staff user by Skool user ID
 */
export async function getStaffBySkoolId(
  skoolUserId: string
): Promise<StaffUserRow | null> {
  try {
    const [data] = await db.select().from(staffUsersTable)
      .where(eq(staffUsersTable.skoolUserId, skoolUserId))
      .limit(1)

    return (data as unknown as StaffUserRow) || null
  } catch (error) {
    console.error('[Staff Users] Error fetching staff by Skool ID:', error)
    return null
  }
}

/**
 * Get a staff user by GHL user ID
 */
export async function getStaffByGhlUserId(
  userId: string,
  ghlUserId: string
): Promise<StaffUserRow | null> {
  try {
    const [data] = await db.select().from(staffUsersTable)
      .where(and(
        eq(staffUsersTable.clerkUserId, userId),
        eq(staffUsersTable.ghlUserId, ghlUserId),
        eq(staffUsersTable.isActive, true)
      ))
      .limit(1)

    return (data as unknown as StaffUserRow) || null
  } catch (error) {
    console.error('[Staff Users] Error fetching staff by GHL ID:', error)
    return null
  }
}

/**
 * Get the default staff user for an account
 */
export async function getDefaultStaff(userId: string): Promise<StaffUserRow | null> {
  // First try to find explicit default
  const [defaultStaff] = await db.select().from(staffUsersTable)
    .where(and(
      eq(staffUsersTable.clerkUserId, userId),
      eq(staffUsersTable.isDefault, true),
      eq(staffUsersTable.isActive, true)
    ))
    .limit(1)

  if (defaultStaff) {
    return defaultStaff as unknown as StaffUserRow
  }

  // Fall back to first active staff user
  const [firstStaff] = await db.select().from(staffUsersTable)
    .where(and(
      eq(staffUsersTable.clerkUserId, userId),
      eq(staffUsersTable.isActive, true)
    ))
    .orderBy(asc(staffUsersTable.createdAt))
    .limit(1)

  return (firstStaff as unknown as StaffUserRow) || null
}

/**
 * Create a new staff user
 */
export async function createStaffUser(input: StaffUserInput): Promise<StaffUserRow> {
  // If setting as default, unset other defaults first
  if (input.isDefault) {
    await db.update(staffUsersTable)
      .set({ isDefault: false })
      .where(eq(staffUsersTable.clerkUserId, input.userId))
  }

  try {
    const [data] = await db.insert(staffUsersTable).values({
      clerkUserId: input.userId,
      skoolUserId: input.skoolUserId,
      skoolUsername: input.skoolUsername || null,
      displayName: input.displayName,
      ghlUserId: input.ghlUserId || null,
      isDefault: input.isDefault || false,
      isActive: input.isActive !== false,
    }).returning()

    return data as unknown as StaffUserRow
  } catch (error) {
    console.error('[Staff Users] Error creating staff user:', error)
    throw new Error(`Failed to create staff user: ${String(error)}`)
  }
}

/**
 * Update a staff user
 */
export async function updateStaffUser(
  id: string,
  updates: Partial<Omit<StaffUserInput, 'userId' | 'skoolUserId'>>
): Promise<StaffUserRow> {
  // If setting as default, need to get the clerk_user_id first
  if (updates.isDefault) {
    const [existing] = await db.select({ clerkUserId: staffUsersTable.clerkUserId })
      .from(staffUsersTable)
      .where(eq(staffUsersTable.id, id))
      .limit(1)

    if (existing?.clerkUserId) {
      await db.update(staffUsersTable)
        .set({ isDefault: false })
        .where(eq(staffUsersTable.clerkUserId, existing.clerkUserId))
    }
  }

  const updateData: Record<string, unknown> = {}
  if (updates.skoolUsername !== undefined)
    updateData.skoolUsername = updates.skoolUsername
  if (updates.displayName !== undefined)
    updateData.displayName = updates.displayName
  if (updates.ghlUserId !== undefined) updateData.ghlUserId = updates.ghlUserId
  if (updates.isDefault !== undefined) updateData.isDefault = updates.isDefault
  if (updates.isActive !== undefined) updateData.isActive = updates.isActive

  try {
    const [data] = await db.update(staffUsersTable)
      .set(updateData)
      .where(eq(staffUsersTable.id, id))
      .returning()

    return data as unknown as StaffUserRow
  } catch (error) {
    console.error('[Staff Users] Error updating staff user:', error)
    throw new Error(`Failed to update staff user: ${String(error)}`)
  }
}

/**
 * Delete a staff user
 */
export async function deleteStaffUser(id: string): Promise<void> {
  try {
    await db.delete(staffUsersTable).where(eq(staffUsersTable.id, id))
  } catch (error) {
    console.error('[Staff Users] Error deleting staff user:', error)
    throw new Error(`Failed to delete staff user: ${String(error)}`)
  }
}

// =============================================================================
// ROUTING LOGIC
// =============================================================================

/**
 * Parse @staffname override from message text
 *
 * Format: "@username " at the start of the message
 * Returns the username (without @) and the remaining message
 */
export function parseStaffOverride(
  message: string
): { username: string; remainingMessage: string } | null {
  // Match @username at start followed by space and message
  // Use [\s\S] instead of . with 's' flag for cross-platform compatibility
  const match = message.match(/^@(\w+)\s+([\s\S]+)$/)
  if (!match) return null

  return {
    username: match[1].toLowerCase(),
    remainingMessage: match[2],
  }
}

/**
 * Resolve which staff user should send an outbound message
 *
 * Priority:
 * 1. @staffname override prefix in message
 * 2. GHL user mapping (who sent the message in GHL)
 * 3. Last conversation (who last talked to this contact in Skool)
 * 4. Default staff (fallback)
 */
export async function resolveOutboundStaff(
  userId: string,
  messageText: string,
  ghlUserId?: string,
  skoolContactId?: string
): Promise<{
  staff: ResolvedStaff | null
  processedMessage: string
}> {
  // 1. Check for @staffname override
  const override = parseStaffOverride(messageText)
  if (override) {
    const [staffByUsername] = await db.select().from(staffUsersTable)
      .where(and(
        eq(staffUsersTable.clerkUserId, userId),
        ilike(staffUsersTable.skoolUsername, override.username),
        eq(staffUsersTable.isActive, true)
      ))
      .limit(1)

    if (staffByUsername) {
      return {
        staff: {
          skoolUserId: staffByUsername.skoolUserId,
          displayName: staffByUsername.displayName,
          ghlUserId: staffByUsername.ghlUserId,
          matchMethod: 'override',
        },
        processedMessage: override.remainingMessage,
      }
    }
    // If override staff not found, continue with original message
    console.warn(
      `[Staff Users] Override @${override.username} not found, using fallback`
    )
  }

  // 2. Check GHL user mapping
  if (ghlUserId) {
    const staffByGhl = await getStaffByGhlUserId(userId, ghlUserId)
    if (staffByGhl) {
      return {
        staff: {
          skoolUserId: staffByGhl.skoolUserId,
          displayName: staffByGhl.displayName,
          ghlUserId: staffByGhl.ghlUserId,
          matchMethod: 'ghl_user',
        },
        processedMessage: messageText,
      }
    }
  }

  // 3. Check last conversation with this contact
  if (skoolContactId) {
    const [lastMessage] = await db.select({
      staffSkoolId: dmMessages.staffSkoolId,
      staffDisplayName: dmMessages.staffDisplayName,
    }).from(dmMessages)
      .where(and(
        eq(dmMessages.clerkUserId, userId),
        eq(dmMessages.skoolUserId, skoolContactId),
        isNotNull(dmMessages.staffSkoolId)
      ))
      .orderBy(desc(dmMessages.createdAt))
      .limit(1)

    if (lastMessage?.staffSkoolId) {
      // Verify this staff is still active
      const [staffFromHistory] = await db.select().from(staffUsersTable)
        .where(and(
          eq(staffUsersTable.skoolUserId, lastMessage.staffSkoolId),
          eq(staffUsersTable.isActive, true)
        ))
        .limit(1)

      if (staffFromHistory) {
        return {
          staff: {
            skoolUserId: staffFromHistory.skoolUserId,
            displayName: staffFromHistory.displayName,
            ghlUserId: staffFromHistory.ghlUserId,
            matchMethod: 'last_conversation',
          },
          processedMessage: messageText,
        }
      }
    }
  }

  // 4. Fallback to default staff
  const defaultStaff = await getDefaultStaff(userId)
  if (defaultStaff) {
    return {
      staff: {
        skoolUserId: defaultStaff.skoolUserId,
        displayName: defaultStaff.displayName,
        ghlUserId: defaultStaff.ghlUserId,
        matchMethod: 'default',
      },
      processedMessage: messageText,
    }
  }

  // No staff configured
  return {
    staff: null,
    processedMessage: messageText,
  }
}

// =============================================================================
// MESSAGE PREFIXES
// =============================================================================

/**
 * Format inbound message with staff attribution
 *
 * Format: "{ContactName} to {StaffName} (via Skool): {message}"
 */
export function formatInboundMessage(
  contactName: string,
  staffDisplayName: string,
  message: string
): string {
  return `${contactName} to ${staffDisplayName} (via Skool): ${message}`
}

/**
 * Format outbound message with staff attribution
 *
 * Format: "{StaffName} (via Skool): {message}"
 */
export function formatOutboundMessage(
  staffDisplayName: string,
  message: string
): string {
  return `${staffDisplayName} (via Skool): ${message}`
}

/**
 * Strip staff prefix from message if present
 *
 * Handles both inbound and outbound formats
 */
export function stripStaffPrefix(message: string): string {
  // Match outbound format: "Name (via Skool): message"
  // Use [\s\S] instead of . with 's' flag for cross-platform compatibility
  const outboundMatch = message.match(/^[^(]+\(via Skool\):\s*([\s\S]+)$/)
  if (outboundMatch) {
    return outboundMatch[1]
  }

  // Match inbound format: "Name to Name (via Skool): message"
  const inboundMatch = message.match(/^[^(]+to\s+[^(]+\(via Skool\):\s*([\s\S]+)$/)
  if (inboundMatch) {
    return inboundMatch[1]
  }

  return message
}
