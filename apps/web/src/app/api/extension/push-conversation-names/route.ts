import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/extension/push-conversation-names
 *
 * Receives participant names from the extension's conversation poll
 * and backfills sender_name on existing dm_messages rows where it's missing.
 * This ensures names show correctly even for contacts from other communities.
 */

interface Participant {
  conversationId: string
  userId: string
  name: string
}

interface PushNamesRequest {
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
    let updated = 0

    // Batch update sender_name on messages where it's currently null/empty
    for (const p of body.participants) {
      if (!p.conversationId || !p.name) continue

      const { count } = await supabase
        .from('dm_messages')
        .update({ sender_name: p.name })
        .eq('skool_conversation_id', p.conversationId)
        .eq('direction', 'inbound')
        .or('sender_name.is.null,sender_name.eq.')
        .select('id', { count: 'exact', head: true })

      updated += count || 0
    }

    if (updated > 0) {
      console.log(`[Extension API] Updated sender_name on ${updated} messages`)
    }

    return NextResponse.json(
      { success: true, updated },
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
