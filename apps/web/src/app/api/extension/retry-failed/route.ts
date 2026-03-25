import { NextRequest, NextResponse } from 'next/server'
import { db, eq, and, inArray } from '@0ne/db/server'
import { dmMessages } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

// =============================================
// POST /api/extension/retry-failed
// =============================================

/**
 * Retry Failed Messages
 *
 * Resets failed outbound messages back to pending status
 * so they can be picked up and retried by the extension.
 */
export async function POST(request: NextRequest) {
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const body = await request.json()
    const { staffSkoolId, messageIds } = body

    if (!staffSkoolId) {
      return NextResponse.json(
        { error: 'Missing required field: staffSkoolId' },
        { status: 400, headers: corsHeaders }
      )
    }

    try {
      // Build conditions for failed outbound messages
      const conditions = [
        eq(dmMessages.direction, 'outbound'),
        eq(dmMessages.status, 'failed'),
        eq(dmMessages.staffSkoolId, staffSkoolId),
      ]

      // If specific message IDs provided, filter to those
      if (messageIds && Array.isArray(messageIds) && messageIds.length > 0) {
        conditions.push(inArray(dmMessages.id, messageIds))
      }

      const data = await db.update(dmMessages)
        .set({ status: 'pending' })
        .where(and(...conditions))
        .returning({ id: dmMessages.id })

      const resetCount = data?.length || 0
      console.log(`[Extension API] Reset ${resetCount} failed messages to pending`)

      return NextResponse.json({
        success: true,
        reset: resetCount,
      }, { headers: corsHeaders })
    } catch (dbError) {
      console.error('[Extension API] Retry failed error:', dbError)
      return NextResponse.json(
        { error: 'Database update failed', details: dbError instanceof Error ? dbError.message : 'Unknown error' },
        { status: 500, headers: corsHeaders }
      )
    }
  } catch (error) {
    console.error('[Extension API] POST retry-failed exception:', error)
    return NextResponse.json(
      {
        success: false,
        reset: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    )
  }
}
