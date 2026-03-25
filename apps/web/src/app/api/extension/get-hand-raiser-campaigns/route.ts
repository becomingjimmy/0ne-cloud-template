import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and } from '@0ne/db/server'
import { staffUsers, dmHandRaiserCampaigns } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

// =============================================
// Types
// =============================================

interface CampaignResponse {
  id: string
  postUrl: string
  skoolPostId: string | null
  communitySlug: string
  keywordFilter: string | null
  ghlTag: string | null
  dmTemplate: string | null
}

// =============================================
// Helpers
// =============================================

/**
 * Extract community slug from a Skool post URL
 * e.g. "https://www.skool.com/fruitful/some-post-abc123" -> "fruitful"
 */
function extractCommunitySlug(postUrl: string): string {
  try {
    const url = new URL(postUrl)
    // Path is like /fruitful/some-post-slug-abc123
    const parts = url.pathname.split('/').filter(Boolean)
    return parts[0] || 'unknown'
  } catch {
    // Fallback: try regex on raw string
    const match = postUrl.match(/skool\.com\/([^/]+)/)
    return match?.[1] || 'unknown'
  }
}

// =============================================
// GET /api/extension/get-hand-raiser-campaigns
// =============================================

/**
 * Returns active hand-raiser campaigns for the authenticated staff member.
 *
 * Query params:
 * - staffSkoolId (required): Skool user ID of the staff member
 *
 * The staffSkoolId is resolved to a Clerk user_id via staff_users table,
 * then campaigns are queried by that user_id.
 */
export async function GET(request: NextRequest) {
  // Validate auth (supports both Clerk and API key)
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    let staffSkoolId = searchParams.get('staffSkoolId')

    // If using Clerk auth and staffSkoolId not provided, use linked Skool ID
    if (authResult.authType === 'clerk' && !staffSkoolId && authResult.skoolUserId) {
      staffSkoolId = authResult.skoolUserId
    }

    if (!staffSkoolId?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Missing required query parameter: staffSkoolId' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Resolve staffSkoolId -> Clerk user_id via staff_users table
    const staffUserRows = await db.select({ clerkUserId: staffUsers.clerkUserId })
      .from(staffUsers)
      .where(eq(staffUsers.skoolUserId, staffSkoolId))

    const staffUser = staffUserRows[0]

    if (!staffUser) {
      console.log(`[Extension API] No staff_users mapping for staffSkoolId: ${staffSkoolId}`)
      return NextResponse.json(
        { success: true, campaigns: [] },
        { headers: corsHeaders }
      )
    }

    const clerkUserId = staffUser.clerkUserId

    // Query active campaigns for this user
    let campaigns
    try {
      campaigns = await db.select({
        id: dmHandRaiserCampaigns.id,
        postUrl: dmHandRaiserCampaigns.postUrl,
        skoolPostId: dmHandRaiserCampaigns.skoolPostId,
        keywordFilter: dmHandRaiserCampaigns.keywordFilter,
        ghlTag: dmHandRaiserCampaigns.ghlTag,
        dmTemplate: dmHandRaiserCampaigns.dmTemplate,
      })
        .from(dmHandRaiserCampaigns)
        .where(and(
          eq(dmHandRaiserCampaigns.clerkUserId, clerkUserId!),
          eq(dmHandRaiserCampaigns.isActive, true)
        ))
    } catch (dbError) {
      console.error('[Extension API] Error fetching hand-raiser campaigns:', dbError)
      return NextResponse.json(
        { success: false, error: dbError instanceof Error ? dbError.message : 'Unknown error' },
        { status: 500, headers: corsHeaders }
      )
    }

    // Transform to camelCase response format with extracted communitySlug
    const campaignResponses: CampaignResponse[] = (campaigns || []).map((c) => ({
      id: c.id,
      postUrl: c.postUrl,
      skoolPostId: c.skoolPostId,
      communitySlug: extractCommunitySlug(c.postUrl),
      keywordFilter: c.keywordFilter,
      ghlTag: c.ghlTag,
      dmTemplate: c.dmTemplate,
    }))

    console.log(
      `[Extension API] Returning ${campaignResponses.length} active campaigns for staff ${staffSkoolId}`
    )

    return NextResponse.json(
      { success: true, campaigns: campaignResponses },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('[Extension API] GET hand-raiser-campaigns exception:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    )
  }
}
