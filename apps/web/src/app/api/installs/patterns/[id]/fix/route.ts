/**
 * POST /api/installs/patterns/[id]/fix
 *
 * Record a known fix for a failure pattern.
 * Auth: Bearer token (TELEMETRY_API_KEY env var)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, eq } from '@0ne/db/server'
import { telemetryFailurePatterns } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Validate bearer token
  const authHeader = request.headers.get('authorization')
  const expectedKey = process.env.TELEMETRY_API_KEY

  if (!expectedKey) {
    console.error('[Installs Pattern Fix API] TELEMETRY_API_KEY environment variable not set')
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500, headers: corsHeaders }
    )
  }

  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i)
  if (!bearerMatch || bearerMatch[1] !== expectedKey) {
    return NextResponse.json(
      { error: 'Invalid or missing authorization' },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const { id } = await params
    const body = await request.json()

    const { known_fix, auto_fixable } = body as {
      known_fix?: string
      auto_fixable?: boolean
    }

    if (!known_fix || typeof known_fix !== 'string' || known_fix.trim().length === 0) {
      return NextResponse.json(
        { error: 'known_fix is required and must be a non-empty string' },
        { status: 400, headers: corsHeaders }
      )
    }

    const updatePayload: Record<string, unknown> = {
      knownFix: known_fix.trim(),
      updatedAt: new Date(),
    }

    if (typeof auto_fixable === 'boolean') {
      updatePayload.autoFixable = auto_fixable
    }

    const [pattern] = await db.update(telemetryFailurePatterns)
      .set(updatePayload)
      .where(eq(telemetryFailurePatterns.id, id))
      .returning()

    if (!pattern) {
      return NextResponse.json(
        { error: 'Pattern not found' },
        { status: 404, headers: corsHeaders }
      )
    }

    return NextResponse.json(
      { success: true, pattern },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('[Installs Pattern Fix API] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
