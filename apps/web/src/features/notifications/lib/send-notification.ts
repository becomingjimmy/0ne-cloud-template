/**
 * Notification Sender
 *
 * Sends daily snapshot notifications via GHL email/SMS
 * based on user preferences.
 */

import { db, eq, and, like } from '@0ne/db/server'
import { notificationPreferences } from '@0ne/db/server'
import type {
  NotificationPreferences,
  DeliveryMethod,
  MetricsConfig,
} from '@0ne/db/types/notifications'
import { DEFAULT_METRICS_CONFIG } from '@0ne/db/types/notifications'
import { ghlClient } from '@/features/kpi/lib/ghl-client'
import { generateDailySnapshot, type FormattedSnapshot } from './generate-snapshot'

// =============================================================================
// TYPES
// =============================================================================

export interface SendResult {
  success: boolean
  method: DeliveryMethod
  emailSent?: boolean
  smsSent?: boolean
  emailMessageId?: string
  smsMessageId?: string
  error?: string
}

export interface NotificationResult {
  userId: string
  success: boolean
  results: SendResult[]
  snapshot?: FormattedSnapshot
  error?: string
}

// =============================================================================
// PREFERENCE LOOKUP
// =============================================================================

/**
 * Get notification preferences for a user
 */
async function getUserPreferences(
  userId: string
): Promise<NotificationPreferences | null> {
  try {
    const [data] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.clerkUserId, userId))
      .limit(1)

    if (!data) {
      return null
    }

    return data as unknown as NotificationPreferences
  } catch (error) {
    console.error('[notifications] Failed to fetch preferences:', error)
    return null
  }
}

/**
 * Get GHL contact ID for a user (via their email)
 */
async function getGhlContactId(email: string): Promise<string | null> {
  try {
    const contact = await ghlClient.searchContactByEmail(email)
    return contact?.id || null
  } catch (error) {
    console.error('[notifications] Failed to find GHL contact:', error)
    return null
  }
}

// =============================================================================
// SEND FUNCTIONS
// =============================================================================

/**
 * Send snapshot via email
 */
async function sendEmail(
  contactId: string,
  snapshot: FormattedSnapshot
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const date = new Date(snapshot.data.date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return ghlClient.sendEmail({
    contactId,
    subject: `Daily KPI Snapshot - ${date}`,
    body: snapshot.emailText,
    html: snapshot.emailHtml,
  })
}

/**
 * Send snapshot via SMS
 */
async function sendSMS(
  contactId: string,
  snapshot: FormattedSnapshot
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return ghlClient.sendSMS({
    contactId,
    message: snapshot.smsText,
  })
}

// =============================================================================
// MAIN SENDER
// =============================================================================

/**
 * Send daily snapshot to a user based on their preferences
 *
 * @param userId - The user's ID (from Clerk)
 * @param methodOverride - Override the user's preferred delivery method
 */
export async function sendDailySnapshot(
  userId: string,
  methodOverride?: DeliveryMethod
): Promise<NotificationResult> {
  console.log(`[notifications] Sending daily snapshot to user ${userId}`)

  try {
    // 1. Get user preferences
    const preferences = await getUserPreferences(userId)

    if (!preferences) {
      return {
        userId,
        success: false,
        results: [],
        error: 'User notification preferences not found',
      }
    }

    if (!preferences.dailySnapshotEnabled && !methodOverride) {
      return {
        userId,
        success: false,
        results: [],
        error: 'Daily snapshots are disabled for this user',
      }
    }

    // 2. Determine delivery method
    const method = methodOverride || preferences.deliveryMethod

    // 3. Get delivery email (fallback to user's primary email would need Clerk lookup)
    const deliveryEmail = preferences.deliveryEmail
    if (!deliveryEmail) {
      return {
        userId,
        success: false,
        results: [],
        error: 'No delivery email configured',
      }
    }

    // 4. Find GHL contact
    const contactId = await getGhlContactId(deliveryEmail)
    if (!contactId) {
      return {
        userId,
        success: false,
        results: [],
        error: `GHL contact not found for email: ${deliveryEmail}`,
      }
    }

    // 5. Generate snapshot
    const snapshot = await generateDailySnapshot(preferences.metricsConfig as MetricsConfig)

    // 6. Send based on method
    const results: SendResult[] = []

    if (method === 'email' || method === 'both') {
      const emailResult = await sendEmail(contactId, snapshot)
      results.push({
        success: emailResult.success,
        method: 'email',
        emailSent: emailResult.success,
        emailMessageId: emailResult.messageId,
        error: emailResult.error,
      })
    }

    if (method === 'sms' || method === 'both') {
      const smsResult = await sendSMS(contactId, snapshot)
      results.push({
        success: smsResult.success,
        method: 'sms',
        smsSent: smsResult.success,
        smsMessageId: smsResult.messageId,
        error: smsResult.error,
      })
    }

    // 7. Determine overall success
    const allSuccess = results.every((r) => r.success)
    const anySuccess = results.some((r) => r.success)

    console.log(
      `[notifications] Snapshot sent to ${userId}: ${results.length} messages, ${results.filter((r) => r.success).length} successful`
    )

    return {
      userId,
      success: anySuccess,
      results,
      snapshot,
      error: allSuccess ? undefined : 'Some notifications failed to send',
    }
  } catch (error) {
    console.error('[notifications] Failed to send snapshot:', error)
    return {
      userId,
      success: false,
      results: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Send daily snapshots to all users who have them enabled
 * and are scheduled for the current time
 *
 * @param currentHour - The current hour (0-23) to match against delivery_time
 */
export async function sendScheduledSnapshots(
  currentHour: number
): Promise<NotificationResult[]> {
  try {
    // Find users with notifications enabled and matching delivery time
    const hourStr = currentHour.toString().padStart(2, '0')
    const eligibleUsers = await db
      .select({ clerkUserId: notificationPreferences.clerkUserId })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.dailySnapshotEnabled, true),
          like(notificationPreferences.deliveryTime, `${hourStr}:%`)
        )
      )

    if (eligibleUsers.length === 0) {
      console.log(`[notifications] No users scheduled for hour ${hourStr}`)
      return []
    }

    console.log(
      `[notifications] Sending snapshots to ${eligibleUsers.length} users at ${hourStr}:00`
    )

    // Send to each user
    const results = await Promise.all(
      eligibleUsers.map((user) => sendDailySnapshot(user.clerkUserId))
    )

    return results
  } catch (error) {
    console.error('[notifications] Failed to fetch scheduled users:', error)
    return []
  }
}

/**
 * Test sending a snapshot to a specific email
 * Useful for debugging and preview
 */
export async function sendTestSnapshot(
  email: string,
  method: DeliveryMethod = 'email'
): Promise<NotificationResult> {
  console.log(`[notifications] Sending test snapshot to ${email}`)

  try {
    // Find GHL contact
    const contactId = await getGhlContactId(email)
    if (!contactId) {
      return {
        userId: 'test',
        success: false,
        results: [],
        error: `GHL contact not found for email: ${email}`,
      }
    }

    // Use default metrics config for test
    const defaultConfig = {
      revenue: true,
      leads: true,
      clients: true,
      fundedAmount: true,
      adSpend: true,
      costPerLead: true,
      skoolMembers: true,
      skoolConversion: true,
    }

    // Generate and send
    const snapshot = await generateDailySnapshot(defaultConfig)
    const results: SendResult[] = []

    if (method === 'email' || method === 'both') {
      const emailResult = await sendEmail(contactId, snapshot)
      results.push({
        success: emailResult.success,
        method: 'email',
        emailSent: emailResult.success,
        emailMessageId: emailResult.messageId,
        error: emailResult.error,
      })
    }

    if (method === 'sms' || method === 'both') {
      const smsResult = await sendSMS(contactId, snapshot)
      results.push({
        success: smsResult.success,
        method: 'sms',
        smsSent: smsResult.success,
        smsMessageId: smsResult.messageId,
        error: smsResult.error,
      })
    }

    return {
      userId: 'test',
      success: results.some((r) => r.success),
      results,
      snapshot,
    }
  } catch (error) {
    console.error('[notifications] Test send failed:', error)
    return {
      userId: 'test',
      success: false,
      results: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
