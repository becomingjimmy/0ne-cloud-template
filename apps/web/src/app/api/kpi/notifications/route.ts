import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq } from '@0ne/db/server'
import { notificationPreferences } from '@0ne/db/server'
import {
  type NotificationPreferences,
  type NotificationPreferencesInput,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_METRICS_CONFIG,
} from '@0ne/db/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/settings/notifications
 * Fetch current user's notification preferences
 */
export async function GET() {
  const { userId } = await auth()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [data] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.clerkUserId, userId))
      .limit(1)

    // If no preferences exist, return defaults with the user ID
    const preferences: NotificationPreferences = data || {
      clerkUserId: userId,
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    return NextResponse.json({ preferences })
  } catch (error) {
    console.error('Error in GET /api/settings/notifications:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/settings/notifications
 * Update (or create) user's notification preferences
 */
export async function PUT(request: Request) {
  const { userId } = await auth()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as NotificationPreferencesInput

    // Validate deliveryMethod if provided
    if (body.deliveryMethod && !['email', 'sms', 'both'].includes(body.deliveryMethod)) {
      return NextResponse.json(
        { error: 'Invalid deliveryMethod. Must be email, sms, or both.' },
        { status: 400 }
      )
    }

    // Validate deliveryTime format if provided (HH:MM:SS or HH:MM)
    if (body.deliveryTime) {
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/
      if (!timeRegex.test(body.deliveryTime)) {
        return NextResponse.json(
          { error: 'Invalid deliveryTime format. Use HH:MM or HH:MM:SS.' },
          { status: 400 }
        )
      }
      // Normalize to HH:MM:SS format
      if (body.deliveryTime.length === 5) {
        body.deliveryTime = `${body.deliveryTime}:00`
      }
    }

    // First, check if a record exists
    const [existing] = await db
      .select({
        clerkUserId: notificationPreferences.clerkUserId,
        metricsConfig: notificationPreferences.metricsConfig,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.clerkUserId, userId))
      .limit(1)

    // Build the upsert data
    const upsertData: Record<string, unknown> = {
      clerkUserId: userId,
      updatedAt: new Date(),
    }

    // Only include fields that were provided
    if (body.dailySnapshotEnabled !== undefined) {
      upsertData.dailySnapshotEnabled = body.dailySnapshotEnabled
    }
    if (body.deliveryTime !== undefined) {
      upsertData.deliveryTime = body.deliveryTime
    }
    if (body.deliveryEmail !== undefined) {
      upsertData.deliveryEmail = body.deliveryEmail
    }
    if (body.deliveryMethod !== undefined) {
      upsertData.deliveryMethod = body.deliveryMethod
    }
    if (body.metricsConfig !== undefined) {
      // Merge with existing or default config
      const existingConfig = existing?.metricsConfig || DEFAULT_METRICS_CONFIG
      upsertData.metricsConfig = {
        ...(existingConfig as Record<string, unknown>),
        ...body.metricsConfig,
      }
    }
    if (body.alertThresholds !== undefined) {
      upsertData.alertThresholds = body.alertThresholds
    }

    // If creating new record, set created_at
    if (!existing) {
      upsertData.createdAt = new Date()
    }

    const [result] = await db
      .insert(notificationPreferences)
      .values(upsertData as typeof notificationPreferences.$inferInsert)
      .onConflictDoUpdate({
        target: notificationPreferences.clerkUserId,
        set: upsertData as Record<string, unknown>,
      })
      .returning()

    if (!result) {
      console.error('Error upserting notification preferences: no row returned')
      return NextResponse.json(
        { error: 'Failed to update preferences' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      preferences: result,
    })
  } catch (error) {
    console.error('Error in PUT /api/settings/notifications:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
