import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/extension/push-conversation-names
 *
 * Receives participant names from the extension's conversation poll
 * and stores them in conversation_sync_status for reliable lookup.
 * Also backfills sender_name on existing dm_messages rows where it's missing.
 */

interface Participant {
  conversationId: string
  userId: string
  name: string
}

interface PushNamesRequest {
  staffSkoolId?: string
  participants: Participant[]
}

export async function POST(request: NextRequest) {
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const body: PushNamesRequest = await request.json()

    if (!Array.isArray(body.participants) || body.participants.length === 0) {
      return NextResponse.json(
        { error: 'participants array is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    const supabase = createServerClient()

    // Resolve staff Skool ID from request body, auth result, or staff_users lookup
    let staffSkoolId = body.staffSkoolId || authResult.skoolUserId || null
    if (!staffSkoolId && authResult.userId) {
      const { data: staffUser } = await supabase
        .from('staff_users')
        .select('skool_user_id')
        .eq('clerk_user_id', authResult.userId)
        .single()
      staffSkoolId = staffUser?.skool_user_id || null
    }

    let updatedMessages = 0
    let updatedSyncStatus = 0
    let errors = 0

    for (const p of body.participants) {
      if (!p.conversationId || !p.name) continue

      // 1) Backfill sender_name on dm_messages where it's NULL
      const { data: nullData, error: nullError } = await supabase
        .from('dm_messages')
        .update({ sender_name: p.name })
        .eq('skool_conversation_id', p.conversationId)
        .is('sender_name', null)
        .select('id')

      if (nullError) {
        console.error(`[Extension API] push-names null update error (${p.conversationId}):`, nullError.message)
        errors++
      } else {
        updatedMessages += nullData?.length || 0
      }

      // 2) Backfill sender_name on dm_messages where it's "Unknown"
      const { data: unknownData, error: unknownError } = await supabase
        .from('dm_messages')
        .update({ sender_name: p.name })
        .eq('skool_conversation_id', p.conversationId)
        .eq('sender_name', 'Unknown')
        .select('id')

      if (unknownError) {
        console.error(`[Extension API] push-names Unknown update error (${p.conversationId}):`, unknownError.message)
        errors++
      } else {
        updatedMessages += unknownData?.length || 0
      }

      // 3) Store name in conversation_sync_status for reliable lookup by conversations API
      if (staffSkoolId) {
        const { error: syncError } = await supabase
          .from('conversation_sync_status')
          .upsert(
            {
              staff_skool_id: staffSkoolId,
              conversation_id: p.conversationId,
              participant_name: p.name,
            },
            {
              onConflict: 'staff_skool_id,conversation_id',
              ignoreDuplicates: false,
            }
          )

        if (syncError) {
          console.error(`[Extension API] push-names sync status error (${p.conversationId}):`, syncError.message)
          errors++
        } else {
          updatedSyncStatus++
        }
      }
    }

    console.log(
      `[Extension API] push-conversation-names: ${updatedMessages} messages backfilled, ${updatedSyncStatus} sync statuses updated, ${errors} errors`
    )

    return NextResponse.json(
      { success: errors === 0, updated: updatedMessages, syncStatusUpdated: updatedSyncStatus, errors },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('[Extension API] push-conversation-names error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
