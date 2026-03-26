import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and, or, isNull, isNotNull, inArray, count } from '@0ne/db/server'
import { skoolMembers, dmContactMappings, dmMessages, contactChannels } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'
import { safeErrorResponse } from '@/lib/security'
import { GHLClient } from '@/features/kpi/lib/ghl-client'
import { parseDisplayName } from '@/features/dm-sync/lib/contact-mapper'

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

export async function POST(request: NextRequest) {
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401, headers: corsHeaders })
  }

  try {
    const stats = {
      members_scanned: 0,
      emails_extracted: 0,
      phones_extracted: 0,
      mappings_updated: 0,
      ghl_matched: 0,
      ghl_phone_matched: 0,
      ghl_created: 0,
      names_cleaned: 0,
      usernames_cleaned: 0,
      junk_deleted: 0,
      slug_enriched: 0,
      unresolvable_deleted: 0,
    }

    // =========================================================================
    // Step 1: Extract emails/phones from survey_answers in skool_members
    // =========================================================================

    const membersWithSurvey = await db.select({
      skoolUserId: skoolMembers.skoolUserId,
      surveyAnswers: skoolMembers.surveyAnswers,
      email: skoolMembers.email,
      phone: skoolMembers.phone,
    })
      .from(skoolMembers)
      .where(isNotNull(skoolMembers.surveyAnswers))

    console.log(`[Backfill] Found ${membersWithSurvey.length} members with survey answers`)
    stats.members_scanned = membersWithSurvey.length

    for (const member of membersWithSurvey) {
      const survey = normalizeSurveyAnswers(member.surveyAnswers)
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
        updates.updatedAt = new Date()
        await db.update(skoolMembers)
          .set(updates)
          .where(eq(skoolMembers.skoolUserId, member.skoolUserId))
      }
    }

    console.log(`[Backfill] Extracted ${stats.emails_extracted} emails, ${stats.phones_extracted} phones`)

    // =========================================================================
    // Step 2: Sync data from skool_members → dm_contact_mappings
    // =========================================================================

    const membersWithData = await db.select({
      skoolUserId: skoolMembers.skoolUserId,
      email: skoolMembers.email,
      phone: skoolMembers.phone,
      skoolUsername: skoolMembers.skoolUsername,
      displayName: skoolMembers.displayName,
    }).from(skoolMembers)

    const allMappings = await db.select({
      skoolUserId: dmContactMappings.skoolUserId,
      email: dmContactMappings.email,
      phone: dmContactMappings.phone,
      skoolUsername: dmContactMappings.skoolUsername,
      skoolDisplayName: dmContactMappings.skoolDisplayName,
    }).from(dmContactMappings)

    const mappingMap = new Map(allMappings.map((m) => [m.skoolUserId, m]))

    for (const member of membersWithData) {
      const mapping = mappingMap.get(member.skoolUserId)
      if (!mapping) continue

      const updates: Record<string, unknown> = {}
      if (member.email && !mapping.email) updates.email = member.email
      if (member.phone && !mapping.phone) updates.phone = member.phone
      if (member.skoolUsername && !mapping.skoolUsername) updates.skoolUsername = member.skoolUsername
      if (member.displayName && !mapping.skoolDisplayName) updates.skoolDisplayName = member.displayName

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date()
        await db.update(dmContactMappings)
          .set(updates)
          .where(eq(dmContactMappings.skoolUserId, member.skoolUserId))
        stats.mappings_updated++
      }
    }

    console.log(`[Backfill] Updated ${stats.mappings_updated} dm_contact_mappings`)

    // =========================================================================
    // Step 2b: Clean up garbage display names in dm_contact_mappings
    // =========================================================================

    const allMappingsForCleanup = await db.select({
      skoolUserId: dmContactMappings.skoolUserId,
      skoolDisplayName: dmContactMappings.skoolDisplayName,
      skoolUsername: dmContactMappings.skoolUsername,
    }).from(dmContactMappings)

    for (const mapping of allMappingsForCleanup) {
      const name = mapping.skoolDisplayName
      if (!name) continue

      const isGarbage = name.length > 50 ||
        name.includes('http') ||
        name.includes(',') ||
        name.includes('assets.skool.com')

      if (isGarbage) {
        const memberRows = await db.select({
          displayName: skoolMembers.displayName,
          skoolUsername: skoolMembers.skoolUsername,
        })
          .from(skoolMembers)
          .where(eq(skoolMembers.skoolUserId, mapping.skoolUserId!))
        const member = memberRows[0]

        let cleanName = mapping.skoolUsername || null
        if (member?.displayName && member.displayName.length <= 50 && !member.displayName.includes('http')) {
          cleanName = member.displayName
        }

        await db.update(dmContactMappings)
          .set({ skoolDisplayName: cleanName, updatedAt: new Date() })
          .where(eq(dmContactMappings.skoolUserId, mapping.skoolUserId!))
        stats.names_cleaned++
      }
    }

    console.log(`[Backfill] Cleaned ${stats.names_cleaned} garbage display names`)

    // =========================================================================
    // Step 2c: Clean up garbage skool_username values
    // =========================================================================

    for (const mapping of allMappingsForCleanup) {
      const username = mapping.skoolUsername
      if (!username) continue

      const isGarbageUsername = username.length > 50 ||
        username.includes('http') ||
        username.includes(',') ||
        username.includes('assets.skool.com')

      if (isGarbageUsername) {
        await db.update(dmContactMappings)
          .set({ skoolUsername: null, updatedAt: new Date() })
          .where(eq(dmContactMappings.skoolUserId, mapping.skoolUserId!))
        stats.usernames_cleaned++
      }
    }

    console.log(`[Backfill] Cleaned ${stats.usernames_cleaned} garbage usernames`)

    // =========================================================================
    // Step 2d: Delete entries with invalid skool_user_id format
    // =========================================================================

    const VALID_SKOOL_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
    const isValidSkoolId = (id: string): boolean => {
      if (id.length < 3) return false
      if (!VALID_SKOOL_ID.test(id)) return false
      if (/^\d+$/.test(id) && id.length < 6) return false
      return true
    }

    const allMappingsForValidation = await db.select({
      id: dmContactMappings.id,
      skoolUserId: dmContactMappings.skoolUserId,
    }).from(dmContactMappings)

    const invalidMappings = allMappingsForValidation.filter(
      (m) => !isValidSkoolId(m.skoolUserId!)
    )

    const allMembersForValidation = await db.select({
      skoolUserId: skoolMembers.skoolUserId,
    }).from(skoolMembers)

    const invalidMembers = allMembersForValidation.filter(
      (m) => !isValidSkoolId(m.skoolUserId)
    )

    const allInvalidUserIds = [
      ...new Set([
        ...invalidMappings.map((m) => m.skoolUserId!),
        ...invalidMembers.map((m) => m.skoolUserId),
      ]),
    ]
    const invalidMappingIds = invalidMappings.map((m) => m.id)

    if (allInvalidUserIds.length > 0) {
      console.log(`[Backfill] Found ${invalidMappings.length} invalid mappings + ${invalidMembers.length} invalid members, deleting...`)

      for (let i = 0; i < allInvalidUserIds.length; i += 50) {
        const batch = allInvalidUserIds.slice(i, i + 50)
        await db.delete(dmMessages).where(inArray(dmMessages.skoolUserId, batch))
      }

      for (let i = 0; i < allInvalidUserIds.length; i += 50) {
        const batch = allInvalidUserIds.slice(i, i + 50)
        await db.delete(contactChannels).where(inArray(contactChannels.skoolUserId, batch))
      }

      for (let i = 0; i < invalidMappingIds.length; i += 100) {
        const batch = invalidMappingIds.slice(i, i + 100)
        await db.delete(dmContactMappings).where(inArray(dmContactMappings.id, batch))
      }

      for (let i = 0; i < invalidMembers.length; i += 50) {
        const batch = invalidMembers.slice(i, i + 50).map((m) => m.skoolUserId)
        await db.delete(skoolMembers).where(inArray(skoolMembers.skoolUserId, batch))
      }

      stats.junk_deleted = invalidMappings.length + invalidMembers.length
      console.log(`[Backfill] Deleted ${invalidMappings.length} mappings + ${invalidMembers.length} members with invalid skool_user_id format`)
    }

    // =========================================================================
    // Step 2e: Enrich contacts missing username/display_name
    // =========================================================================

    const mappingsNeedingEnrichment = await db.select({
      id: dmContactMappings.id,
      skoolUserId: dmContactMappings.skoolUserId,
      skoolUsername: dmContactMappings.skoolUsername,
      skoolDisplayName: dmContactMappings.skoolDisplayName,
      email: dmContactMappings.email,
      phone: dmContactMappings.phone,
      ghlContactId: dmContactMappings.ghlContactId,
    })
      .from(dmContactMappings)
      .where(isNull(dmContactMappings.skoolUsername))

    for (const mapping of mappingsNeedingEnrichment) {
      const uid = mapping.skoolUserId!

      if (uid.includes('-') && isValidSkoolId(uid)) {
        const parts = uid.replace(/-\d+$/, '').split('-')
        const displayName = parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')

        await db.update(dmContactMappings)
          .set({
            skoolUsername: uid,
            skoolDisplayName: mapping.skoolDisplayName || displayName,
            updatedAt: new Date(),
          })
          .where(eq(dmContactMappings.id, mapping.id))
        stats.slug_enriched++
      } else if (!mapping.email && !mapping.phone && !mapping.ghlContactId) {
        const msgCountRows = await db.select({ value: count() })
          .from(dmMessages)
          .where(eq(dmMessages.skoolUserId, uid))

        if (!msgCountRows[0]?.value || msgCountRows[0].value === 0) {
          await db.delete(contactChannels).where(eq(contactChannels.skoolUserId, uid))
          await db.delete(dmContactMappings).where(eq(dmContactMappings.id, mapping.id))
          stats.unresolvable_deleted++
        }
      }
    }

    console.log(`[Backfill] Enriched ${stats.slug_enriched} contacts from slug-format skool_user_id, deleted ${stats.unresolvable_deleted} unresolvable`)

    // =========================================================================
    // Step 3: Auto-match unmatched members against GHL
    // =========================================================================

    const unmatchedWithContact = await db.select({
      skoolUserId: skoolMembers.skoolUserId,
      email: skoolMembers.email,
      phone: skoolMembers.phone,
      displayName: skoolMembers.displayName,
      skoolUsername: skoolMembers.skoolUsername,
      surveyAnswers: skoolMembers.surveyAnswers,
    })
      .from(skoolMembers)
      .where(and(
        isNull(skoolMembers.ghlContactId),
        or(isNotNull(skoolMembers.email), isNotNull(skoolMembers.phone))
      ))

    if (unmatchedWithContact.length > 0) {
      console.log(`[Backfill] Auto-matching ${unmatchedWithContact.length} unmatched members (email/phone)...`)

      try {
        const ghl = new GHLClient()
        const MAX_MATCHES = 200

        for (const member of unmatchedWithContact.slice(0, MAX_MATCHES)) {
          try {
            let contact = null
            let matchMethod = ''

            if (member.email) {
              contact = await ghl.searchContactByEmail(member.email)
              if (contact) matchMethod = 'email'
              await new Promise((r) => setTimeout(r, 200))
            }

            if (!contact && member.phone) {
              contact = await ghl.searchContactByPhone(member.phone)
              if (contact) matchMethod = 'phone'
              await new Promise((r) => setTimeout(r, 200))
            }

            if (!contact && (member.email || member.phone)) {
              const { firstName, lastName } = parseDisplayName(member.displayName || 'Unknown')

              const customFields: Array<{ key: string; field_value: string }> = []
              const survey = normalizeSurveyAnswers(member.surveyAnswers)
              if (survey) {
                const fieldKeys = ['contact.skool_answer_1', 'contact.skool_answer_2', 'contact.skool_answer_3']
                for (let i = 0; i < Math.min(survey.length, 3); i++) {
                  const answer = (survey[i] as { answer?: string })?.answer
                  if (answer) {
                    customFields.push({ key: fieldKeys[i], field_value: answer })
                  }
                }
              }

              try {
                contact = await ghl.createContact({
                  email: member.email || undefined,
                  phone: member.phone || undefined,
                  firstName,
                  lastName: lastName || undefined,
                  tags: ['skool - completed registration', 'skool_auto_created'],
                  customFields: customFields.length > 0 ? customFields : undefined,
                })
                matchMethod = 'auto_created'
                stats.ghl_created++
                console.log(`[Backfill] Created GHL contact for ${member.email || member.phone} → ${contact.id}`)
              } catch (createError) {
                console.error(`[Backfill] Create error for ${member.email || member.phone}:`, createError)
              }
              await new Promise((r) => setTimeout(r, 200))
            }

            if (contact && matchMethod) {
              if (matchMethod === 'email') stats.ghl_matched++
              if (matchMethod === 'phone') stats.ghl_phone_matched++

              await db.transaction(async (tx) => {
                await tx.update(skoolMembers).set({
                  ghlContactId: contact.id,
                  matchedAt: new Date(),
                  matchMethod,
                  updatedAt: new Date(),
                }).where(eq(skoolMembers.skoolUserId, member.skoolUserId))

                await tx.update(dmContactMappings).set({
                  ghlContactId: contact.id,
                  matchMethod,
                  email: member.email,
                  updatedAt: new Date(),
                }).where(eq(dmContactMappings.skoolUserId, member.skoolUserId))
              })
            }
          } catch (matchError) {
            console.error(`[Backfill] Match error for ${member.email || member.phone}:`, matchError)
          }
        }

        if (unmatchedWithContact.length > MAX_MATCHES) {
          console.log(`[Backfill] ${unmatchedWithContact.length - MAX_MATCHES} remaining — run again`)
        }
      } catch (ghlError) {
        console.error('[Backfill] GHL client error:', ghlError)
      }
    }

    console.log(`[Backfill] Complete:`, stats)
    return NextResponse.json({ success: true, stats }, { headers: corsHeaders })
  } catch (error) {
    console.error('[Backfill] Exception:', error)
    return safeErrorResponse('Failed to backfill emails', error, 500, corsHeaders)
  }
}
