import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@0ne/db/server'
import { parseDisplayName } from '@/features/dm-sync/lib/contact-mapper'

export const dynamic = 'force-dynamic'

/**
 * POST /api/dm-sync/contacts/[skoolUserId]/synthetic
 * Create a synthetic GHL contact for an unmatched Skool user.
 * 100% MANUAL — only triggered by user clicking the Synthetic button.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ skoolUserId: string }> }
) {
  try {
    const { skoolUserId } = await params
    const supabase = createServerClient()

    // 1. Fetch the existing mapping for name/username
    const { data: mapping, error: mappingError } = await supabase
      .from('dm_contact_mappings')
      .select('*')
      .eq('skool_user_id', skoolUserId)
      .single()

    if (mappingError || !mapping) {
      return NextResponse.json(
        { error: 'Contact mapping not found' },
        { status: 404 }
      )
    }

    if (mapping.ghl_contact_id) {
      return NextResponse.json(
        { error: 'Contact already has a GHL contact ID', ghlContactId: mapping.ghl_contact_id },
        { status: 409 }
      )
    }

    // 2. Generate synthetic email
    const syntheticEmail = `${skoolUserId}@skool-sync.0ne.ai`

    // 3. Parse display name
    const displayName = mapping.skool_display_name || mapping.skool_username || 'Unknown'
    const nameParts = parseDisplayName(displayName)

    // 4. Create GHL contact via API
    const GHL_API_BASE = 'https://services.leadconnectorhq.com'
    const locationId = process.env.GHL_LOCATION_ID
    const apiKey = process.env.GHL_API_KEY

    if (!locationId || !apiKey) {
      return NextResponse.json(
        { error: 'GHL_LOCATION_ID and GHL_API_KEY environment variables are required' },
        { status: 500 }
      )
    }

    const ghlBody: Record<string, unknown> = {
      locationId,
      email: syntheticEmail,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      tags: ['skool_synthetic', 'created_from_contacts_page', 'skool_member'],
    }

    const ghlResponse = await fetch(`${GHL_API_BASE}/contacts/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify(ghlBody),
    })

    if (!ghlResponse.ok) {
      const errorText = await ghlResponse.text()
      console.error('[Contacts API] GHL create contact failed:', errorText)
      return NextResponse.json(
        { error: `Failed to create GHL contact: ${ghlResponse.status}` },
        { status: 500 }
      )
    }

    const ghlResult = (await ghlResponse.json()) as { contact?: { id: string } }
    const ghlContactId = ghlResult.contact?.id

    if (!ghlContactId) {
      return NextResponse.json(
        { error: 'GHL response missing contact ID' },
        { status: 500 }
      )
    }

    // 5. Update dm_contact_mappings
    await supabase
      .from('dm_contact_mappings')
      .update({
        ghl_contact_id: ghlContactId,
        match_method: 'synthetic',
        email: syntheticEmail,
        updated_at: new Date().toISOString(),
      })
      .eq('skool_user_id', skoolUserId)

    // 6. Update skool_members if applicable
    await supabase
      .from('skool_members')
      .update({
        ghl_contact_id: ghlContactId,
        matched_at: new Date().toISOString(),
        match_method: 'synthetic',
      })
      .eq('skool_user_id', skoolUserId)

    console.log(`[Contacts API] Created synthetic GHL contact ${ghlContactId} for ${skoolUserId}`)

    return NextResponse.json({ success: true, ghlContactId })
  } catch (error) {
    console.error('[Contacts API] POST synthetic exception:', error)
    return NextResponse.json(
      { error: 'Failed to create synthetic contact', details: String(error) },
      { status: 500 }
    )
  }
}
