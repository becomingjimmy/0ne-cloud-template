import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/dm-sync/contacts/[skoolUserId]
 * Manual match: link a Skool user to a GHL contact ID
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ skoolUserId: string }> }
) {
  try {
    const { skoolUserId } = await params
    const body = await request.json()
    const { ghl_contact_id } = body as { ghl_contact_id: string }

    if (!ghl_contact_id?.trim()) {
      return NextResponse.json(
        { error: 'ghl_contact_id is required' },
        { status: 400 }
      )
    }

    const supabase = createServerClient()

    // Update dm_contact_mappings
    const { error: mappingError } = await supabase
      .from('dm_contact_mappings')
      .update({
        ghl_contact_id: ghl_contact_id.trim(),
        match_method: 'manual',
        updated_at: new Date().toISOString(),
      })
      .eq('skool_user_id', skoolUserId)

    if (mappingError) {
      console.error('[Contacts API] PATCH mapping error:', mappingError)
      return NextResponse.json({ error: mappingError.message }, { status: 500 })
    }

    // Also update skool_members if the user exists there
    await supabase
      .from('skool_members')
      .update({
        ghl_contact_id: ghl_contact_id.trim(),
        matched_at: new Date().toISOString(),
        match_method: 'manual',
      })
      .eq('skool_user_id', skoolUserId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Contacts API] PATCH exception:', error)
    return NextResponse.json(
      { error: 'Failed to update contact', details: String(error) },
      { status: 500 }
    )
  }
}
