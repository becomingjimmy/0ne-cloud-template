import { NextRequest, NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { createServerClient } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-Id',
}

/**
 * OPTIONS /api/extension/push-kpis
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

/**
 * Chrome Extension Push KPIs API
 *
 * Receives KPI/metrics data from the Skool Chrome extension
 * and stores them in the skool_kpis table.
 */

// =============================================
// Types
// =============================================

interface IncomingKpi {
  metricName: string
  metricValue: number | null
}

interface PushKpisRequest {
  staffSkoolId: string
  groupId: string
  kpis: IncomingKpi[]
}

interface PushKpisResponse {
  success: boolean
  inserted: number
  errors?: string[]
}

// =============================================
// Auth Helper (Supports both Clerk and API key)
// =============================================

interface AuthResult {
  valid: boolean
  authType: 'clerk' | 'apiKey' | null
  userId?: string
  skoolUserId?: string
  error?: string
}

async function validateExtensionAuth(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    return { valid: false, authType: null, error: 'Missing Authorization header' }
  }

  // Check for Clerk auth first (Clerk <token>)
  if (authHeader.startsWith('Clerk ')) {
    try {
      const { userId } = await auth()
      if (userId) {
        const client = await clerkClient()
        const user = await client.users.getUser(userId)
        const skoolUserId = (user.publicMetadata?.skoolUserId as string) || undefined

        return { valid: true, authType: 'clerk', userId, skoolUserId }
      }
      return { valid: false, authType: 'clerk', error: 'Invalid or expired Clerk session' }
    } catch {
      return { valid: false, authType: 'clerk', error: 'Failed to validate Clerk session' }
    }
  }

  // Check for Bearer token (API key)
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  if (bearerMatch) {
    const expectedKey = process.env.EXTENSION_API_KEY
    if (!expectedKey) {
      console.error('[Extension API] EXTENSION_API_KEY environment variable not set')
      return { valid: false, authType: 'apiKey', error: 'Server configuration error' }
    }

    if (bearerMatch[1] === expectedKey) {
      return { valid: true, authType: 'apiKey' }
    }
    return { valid: false, authType: 'apiKey', error: 'Invalid API key' }
  }

  return { valid: false, authType: null, error: 'Invalid Authorization header format' }
}

// =============================================
// POST /api/extension/push-kpis
// =============================================

export async function POST(request: NextRequest) {
  // Validate auth (supports both Clerk and API key)
  const authResult = await validateExtensionAuth(request)
  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const body: PushKpisRequest = await request.json()

    // If using Clerk auth and staffSkoolId not provided, use linked Skool ID
    if (authResult.authType === 'clerk' && !body.staffSkoolId && authResult.skoolUserId) {
      body.staffSkoolId = authResult.skoolUserId
    }

    // Validate request structure
    const validationError = validateRequest(body)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400, headers: corsHeaders })
    }

    const { staffSkoolId, groupId, kpis } = body
    const now = new Date().toISOString()

    console.log(
      `[Extension API] Received ${kpis.length} KPIs for group ${groupId}`
    )

    const supabase = createServerClient()
    let inserted = 0
    const errors: string[] = []

    // Insert KPIs (always create new records for time-series data)
    for (const kpi of kpis) {
      try {
        const kpiRow = {
          staff_skool_id: staffSkoolId,
          group_id: groupId,
          metric_name: kpi.metricName,
          metric_value: kpi.metricValue,
          recorded_at: now,
        }

        const { error } = await supabase.from('skool_kpis').insert(kpiRow)

        if (error) {
          console.error(`[Extension API] Error inserting KPI ${kpi.metricName}:`, error)
          errors.push(`KPI ${kpi.metricName}: ${error.message}`)
        } else {
          inserted++
        }
      } catch (kpiError) {
        console.error(`[Extension API] Exception processing KPI ${kpi.metricName}:`, kpiError)
        errors.push(
          `KPI ${kpi.metricName}: ${kpiError instanceof Error ? kpiError.message : 'Unknown error'}`
        )
      }
    }

    console.log(
      `[Extension API] KPIs complete: inserted=${inserted}, errors=${errors.length}`
    )

    const response: PushKpisResponse = {
      success: errors.length === 0,
      inserted,
      ...(errors.length > 0 && { errors }),
    }

    return NextResponse.json(response, { headers: corsHeaders })
  } catch (error) {
    console.error('[Extension API] POST exception:', error)
    return NextResponse.json(
      {
        success: false,
        inserted: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      } as PushKpisResponse,
      { status: 500, headers: corsHeaders }
    )
  }
}

// =============================================
// Validation
// =============================================

function validateRequest(body: PushKpisRequest): string | null {
  if (!body.staffSkoolId?.trim()) {
    return 'Missing required field: staffSkoolId'
  }

  if (!body.groupId?.trim()) {
    return 'Missing required field: groupId'
  }

  if (!Array.isArray(body.kpis)) {
    return 'kpis must be an array'
  }

  if (body.kpis.length === 0) {
    return 'kpis array cannot be empty'
  }

  // Validate each KPI
  for (let i = 0; i < body.kpis.length; i++) {
    const kpi = body.kpis[i]
    if (!kpi.metricName?.trim()) {
      return `KPI at index ${i}: missing required field "metricName"`
    }
  }

  return null
}
