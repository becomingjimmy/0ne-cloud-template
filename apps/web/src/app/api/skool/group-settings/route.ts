import { NextRequest, NextResponse } from 'next/server'
import { db, eq } from '@0ne/db/server'
import { skoolGroupSettings } from '@0ne/db/server'
import type { EmailBlastStatus } from '@0ne/db'

export const dynamic = 'force-dynamic'

const COOLDOWN_HOURS = 72

/**
 * GET /api/skool/group-settings
 * Get group settings including email blast status
 *
 * Query params:
 * - group_slug: The group to get settings for (default: 'fruitful')
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const groupSlug = searchParams.get('group_slug') || 'fruitful'

    const [data] = await db
      .select()
      .from(skoolGroupSettings)
      .where(eq(skoolGroupSettings.groupSlug, groupSlug))

    // Calculate email blast status
    const lastBlastAt = data?.lastEmailBlastAt ? new Date(data.lastEmailBlastAt) : null
    let available = true
    let hoursUntilAvailable = 0

    if (lastBlastAt) {
      const cooldownEnd = new Date(lastBlastAt.getTime() + COOLDOWN_HOURS * 60 * 60 * 1000)
      const now = new Date()

      if (now < cooldownEnd) {
        available = false
        hoursUntilAvailable = Math.ceil((cooldownEnd.getTime() - now.getTime()) / (60 * 60 * 1000))
      }
    }

    const emailBlastStatus: EmailBlastStatus = {
      available,
      hours_until_available: hoursUntilAvailable,
      last_blast_at: data?.lastEmailBlastAt?.toISOString() || null,
    }

    return NextResponse.json({
      settings: data || { group_slug: groupSlug, last_email_blast_at: null },
      email_blast_status: emailBlastStatus,
    })
  } catch (error) {
    console.error('[Group Settings API] GET exception:', error)
    return NextResponse.json(
      { error: 'Failed to fetch group settings', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/skool/group-settings/record-blast
 * Record that an email blast was sent
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const groupSlug = body.group_slug || 'fruitful'

    const now = new Date()

    // Upsert the group settings with the new blast time
    const [upserted] = await db
      .insert(skoolGroupSettings)
      .values({
        groupSlug,
        lastEmailBlastAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: skoolGroupSettings.groupSlug,
        set: {
          lastEmailBlastAt: now,
          updatedAt: now,
        },
      })
      .returning()

    return NextResponse.json({ settings: upserted })
  } catch (error) {
    console.error('[Group Settings API] POST exception:', error)
    return NextResponse.json(
      { error: 'Failed to record email blast', details: String(error) },
      { status: 500 }
    )
  }
}
