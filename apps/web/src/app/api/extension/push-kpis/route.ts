import { NextRequest, NextResponse } from 'next/server'
import { db } from '@0ne/db/server'
import { skoolKpis } from '@0ne/db/server'
import { corsHeaders, validateExtensionAuth } from '@/lib/extension-auth'

export { OPTIONS } from '@/lib/extension-auth'

export const dynamic = 'force-dynamic'

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
    const now = new Date()

    console.log(
      `[Extension API] Received ${kpis.length} KPIs for group ${groupId}`
    )

    let inserted = 0
    const errors: string[] = []

    // Insert KPIs (always create new records for time-series data)
    for (const kpi of kpis) {
      try {
        await db.insert(skoolKpis).values({
          staffSkoolId,
          groupId,
          metricName: kpi.metricName,
          metricValue: kpi.metricValue != null ? kpi.metricValue : null,
          recordedAt: now,
        })

        inserted++
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
