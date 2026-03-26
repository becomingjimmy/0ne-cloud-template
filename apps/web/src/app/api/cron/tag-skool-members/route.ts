/**
 * Tag Skool Members in GHL
 *
 * Finds GHL contacts by Skool member email and adds "skool - completed registration" tag.
 * Run manually to fix contacts that didn't get tagged by Zapier.
 *
 * curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/tag-skool-members"
 */

import { NextRequest, NextResponse } from 'next/server'
import { safeErrorResponse } from '@/lib/security'
import { db, and, isNull, isNotNull, asc } from '@0ne/db/server'
import { skoolMembers } from '@0ne/db/server'
import { GHLClient } from '@/features/kpi/lib/ghl-client'
import { secureCompare } from '@/lib/security'

export const maxDuration = 300 // 5 minutes max

const SKOOL_TAG = 'skool - completed registration'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || !authHeader || !secureCompare(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dry') === 'true'
  const limitParam = searchParams.get('limit')
  const limitVal = limitParam ? parseInt(limitParam) : undefined

  const ghl = new GHLClient()

  const stats = {
    total: 0,
    found: 0,
    alreadyTagged: 0,
    tagged: 0,
    notFound: 0,
    errors: 0,
  }

  try {
    // Get all Skool member emails that don't have a GHL match
    let query = db
      .select({ email: skoolMembers.email })
      .from(skoolMembers)
      .where(and(isNotNull(skoolMembers.email), isNull(skoolMembers.ghlContactId)))
      .orderBy(asc(skoolMembers.email))
      .$dynamic()

    if (limitVal) {
      query = query.limit(limitVal)
    }

    const members = await query

    stats.total = members.length
    console.log(`[tag-skool] Processing ${members.length} unmatched Skool members...`)

    for (const member of members) {
      if (!member.email) continue

      try {
        // Search GHL for this email
        const contact = await ghl.searchContactByEmail(member.email)

        if (!contact) {
          stats.notFound++
          continue
        }

        stats.found++

        // Check if already has the tag
        const hasTag = contact.tags?.some(
          (t) => t.toLowerCase() === SKOOL_TAG.toLowerCase()
        )

        if (hasTag) {
          stats.alreadyTagged++
          continue
        }

        // Add the tag
        if (!dryRun) {
          await ghl.updateContactTags(contact.id, [SKOOL_TAG])
          console.log(`[tag-skool] Tagged: ${member.email}`)
        } else {
          console.log(`[tag-skool] Would tag: ${member.email}`)
        }
        stats.tagged++

        // Rate limit - 200ms between API calls
        await new Promise((resolve) => setTimeout(resolve, 200))
      } catch (error) {
        console.error(`[tag-skool] Error processing ${member.email}:`, error)
        stats.errors++
      }
    }

    console.log(`[tag-skool] Complete:`, stats)

    return NextResponse.json({
      success: true,
      dryRun,
      stats,
    })
  } catch (error) {
    console.error('[tag-skool] Error:', error)
    return safeErrorResponse('Failed to tag Skool members', error)
  }
}
