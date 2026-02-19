import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'
import { GHLClient } from '@/features/kpi/lib/ghl-client'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for full backfill

/**
 * POST /api/extension/backfill-emails
 *
 * Backfill: extract emails/phones from existing survey_answers
 * in skool_members, update both skool_members and dm_contact_mappings,
 * and auto-match unmatched members against GHL.
 */

// =============================================
// Survey extraction (same logic as push-members)
// =============================================

function extractEmailFromSurvey(qa: unknown): string | null {
  if (!qa || !Array.isArray(qa)) return null
  for (const item of qa) {
    const answer = (item?.answer || '') as string
    if (answer.includes('@') && answer.includes('.')) {
      const emailMatch = answer.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
      if (emailMatch) return emailMatch[0].toLowerCase()
    }
  }
  return null
}

function extractPhoneFromSurvey(qa: unknown): string | null {
  if (!qa || !Array.isArray(qa)) return null
  for (const item of qa) {
    const question = ((item?.question || '') as string).toLowerCase()
    const answer = (item?.answer || '') as string
    if (question.includes('phone') || question.includes('cell') || question.includes('mobile') || question.includes('whatsapp')) {
      const digits = answer.replace(/\D/g, '')
      if (digits.length >= 10) {
        return digits.length === 10 ? `+1${digits}` : `+${digits}`
      }
    }
  }
  return null
}

function normalizeSurveyAnswers(raw: unknown): unknown[] | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'object' && 'survey' in (raw as Record<string, unknown>)) {
    const inner = (raw as { survey: unknown }).survey
    if (Array.isArray(inner)) return inner
  }
  return null
}

/** Paginated fetch — gets ALL rows matching a query */
async function fetchAllRows<T>(
  supabase: ReturnType<typeof createServerClient>,
  table: string,
  select: string,
  filters?: (query: ReturnType<ReturnType<typeof createServerClient>['from']>['select']) => ReturnType<ReturnType<typeof createServerClient>['from']>['select']>
): Promise<T[]> {
  const PAGE_SIZE = 1000
  const allRows: T[] = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    let query = supabase.from(table).select(select).range(offset, offset + PAGE_SIZE - 1)
    if (filters) {
      query = filters(query) as typeof query
    }
    const { data, error } = await query
    if (error) throw error
    if (!data || data.length === 0) {
      hasMore = false
    } else {
      allRows.push(...(data as T[]))
      offset += data.length
      if (data.length < PAGE_SIZE) hasMore = false
    }
  }
  return allRows
}

export async function POST(request: NextRequest) {
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401, headers: corsHeaders })
  }

  try {
    const supabase = createServerClient()
    const stats = {
      members_scanned: 0,
      emails_extracted: 0,
      phones_extracted: 0,
      mappings_updated: 0,
      ghl_matched: 0,
    }

    // =========================================================================
    // Step 1: Extract emails/phones from survey_answers in skool_members
    // Paginated — processes ALL members, not just the first 1000
    // =========================================================================

    const membersWithSurvey = await fetchAllRows<{
      skool_user_id: string
      survey_answers: unknown
      email: string | null
      phone: string | null
    }>(supabase, 'skool_members', 'skool_user_id, survey_answers, email, phone', (q) =>
      q.not('survey_answers', 'is', null)
    )

    console.log(`[Backfill] Found ${membersWithSurvey.length} members with survey answers`)
    stats.members_scanned = membersWithSurvey.length

    for (const member of membersWithSurvey) {
      const survey = normalizeSurveyAnswers(member.survey_answers)
      const surveyEmail = extractEmailFromSurvey(survey)
      const surveyPhone = extractPhoneFromSurvey(survey)
      const updates: Record<string, unknown> = {}

      if (surveyEmail && !member.email) {
        updates.email = surveyEmail
        stats.emails_extracted++
      }
      if (surveyPhone && !member.phone) {
        updates.phone = surveyPhone
        stats.phones_extracted++
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('skool_members')
          .update(updates)
          .eq('skool_user_id', member.skool_user_id)
      }
    }

    console.log(`[Backfill] Extracted ${stats.emails_extracted} emails, ${stats.phones_extracted} phones`)

    // =========================================================================
    // Step 2: Sync emails/phones from skool_members → dm_contact_mappings
    // =========================================================================

    const membersWithData = await fetchAllRows<{
      skool_user_id: string
      email: string | null
      phone: string | null
    }>(supabase, 'skool_members', 'skool_user_id, email, phone', (q) =>
      q.or('email.not.is.null,phone.not.is.null')
    )

    const allMappings = await fetchAllRows<{
      skool_user_id: string
      email: string | null
      phone: string | null
    }>(supabase, 'dm_contact_mappings', 'skool_user_id, email, phone')

    const mappingMap = new Map(allMappings.map((m) => [m.skool_user_id, m]))

    for (const member of membersWithData) {
      const mapping = mappingMap.get(member.skool_user_id)
      if (!mapping) continue

      const updates: Record<string, unknown> = {}
      if (member.email && !mapping.email) updates.email = member.email
      if (member.phone && !mapping.phone) updates.phone = member.phone

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString()
        await supabase
          .from('dm_contact_mappings')
          .update(updates)
          .eq('skool_user_id', member.skool_user_id)
        stats.mappings_updated++
      }
    }

    console.log(`[Backfill] Updated ${stats.mappings_updated} dm_contact_mappings`)

    // =========================================================================
    // Step 3: Auto-match unmatched members with email against GHL
    // =========================================================================

    const unmatchedWithEmail = await fetchAllRows<{
      skool_user_id: string
      email: string | null
      display_name: string | null
      skool_username: string | null
    }>(supabase, 'skool_members', 'skool_user_id, email, display_name, skool_username', (q) =>
      q.is('ghl_contact_id', null).not('email', 'is', null)
    )

    if (unmatchedWithEmail.length > 0) {
      console.log(`[Backfill] Auto-matching ${unmatchedWithEmail.length} unmatched members with email...`)

      try {
        const ghl = new GHLClient()
        const MAX_MATCHES = 200

        for (const member of unmatchedWithEmail.slice(0, MAX_MATCHES)) {
          if (!member.email) continue

          try {
            const contact = await ghl.searchContactByEmail(member.email)
            if (contact) {
              await supabase
                .from('skool_members')
                .update({
                  ghl_contact_id: contact.id,
                  matched_at: new Date().toISOString(),
                  match_method: 'email',
                })
                .eq('skool_user_id', member.skool_user_id)

              await supabase
                .from('dm_contact_mappings')
                .update({
                  ghl_contact_id: contact.id,
                  match_method: 'email',
                  email: member.email,
                  updated_at: new Date().toISOString(),
                })
                .eq('skool_user_id', member.skool_user_id)

              stats.ghl_matched++
            }

            await new Promise((r) => setTimeout(r, 200))
          } catch (matchError) {
            console.error(`[Backfill] Match error for ${member.email}:`, matchError)
          }
        }

        if (unmatchedWithEmail.length > MAX_MATCHES) {
          console.log(`[Backfill] ${unmatchedWithEmail.length - MAX_MATCHES} remaining — run again`)
        }
      } catch (ghlError) {
        console.error('[Backfill] GHL client error:', ghlError)
      }
    }

    console.log(`[Backfill] Complete:`, stats)
    return NextResponse.json({ success: true, stats }, { headers: corsHeaders })
  } catch (error) {
    console.error('[Backfill] Exception:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
