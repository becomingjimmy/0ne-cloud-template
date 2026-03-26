/**
 * Test Notification API
 *
 * Sends a test notification to the authenticated user using their
 * current notification preferences.
 */

import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { safeErrorResponse } from '@/lib/security'
import { db, eq } from '@0ne/db/server'
import { notificationPreferences } from '@0ne/db/server'
import { sendDailySnapshot } from '@/features/notifications/lib/send-notification'
import type { DeliveryMethod } from '@0ne/db/types'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const { userId } = await auth()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Parse optional method override from request body
    let methodOverride: DeliveryMethod | undefined
    try {
      const body = await request.json()
      if (body.method && ['email', 'sms', 'both'].includes(body.method)) {
        methodOverride = body.method as DeliveryMethod
      }
    } catch {
      // No body or invalid JSON is fine, we'll use user's preferences
    }

    // Get user's email from Clerk if no delivery_email is set
    const [prefs] = await db
      .select({ deliveryEmail: notificationPreferences.deliveryEmail })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.clerkUserId, userId))
      .limit(1)

    // If no delivery email in preferences, try to get from Clerk
    if (!prefs?.deliveryEmail) {
      const user = await currentUser()
      const primaryEmail = user?.emailAddresses[0]?.emailAddress

      if (primaryEmail) {
        // Temporarily set the delivery email for this test
        await db
          .insert(notificationPreferences)
          .values({
            clerkUserId: userId,
            deliveryEmail: primaryEmail,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: notificationPreferences.clerkUserId,
            set: {
              deliveryEmail: primaryEmail,
              updatedAt: new Date(),
            },
          })
      }
    }

    // Send the test notification (pass 'email' as default if no override)
    // Using the user's preferences, but forcing the send even if daily_snapshot_enabled is false
    const result = await sendDailySnapshot(userId, methodOverride || 'email')

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Test notification sent successfully',
        results: result.results,
      })
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Failed to send test notification',
          results: result.results,
        },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('[api/settings/notifications/test] Error:', error)
    return safeErrorResponse('Failed to send test notification', error)
  }
}
