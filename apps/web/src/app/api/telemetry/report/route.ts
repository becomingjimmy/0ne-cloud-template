/**
 * POST /api/telemetry/report
 *
 * Receives telemetry events from 0ne Doctor and Install Wizard.
 * Stores structured results in Neon (PostgreSQL) for install analytics and improvement.
 * Auto-detects failure patterns and returns known fixes when available.
 *
 * Auth: Bearer token (TELEMETRY_API_KEY env var)
 */

import { NextRequest, NextResponse } from 'next/server'
import { secureCompare } from '@/lib/security'
import { db, eq } from '@0ne/db/server'
import { telemetryEvents, telemetryFailurePatterns, userInstalls } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

// CORS headers for CLI tools (not browsers, but good practice)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

// =============================================
// Types
// =============================================

interface FixAction {
  check_name: string
  category: string
  before_status: string
  before_detail: string
  action_taken: string
  after_status: string
  after_detail: string
  success: boolean
  error?: string
}

interface FixSummary {
  fixes_attempted: number
  fixes_succeeded: number
  fixes_failed: number
}

interface TelemetryRequest {
  event_type: 'doctor' | 'install'
  platform?: string
  arch?: string
  os_version?: string
  bun_version?: string
  one_version?: string
  principal_name?: string
  install_token?: string
  results: unknown
  fix_actions?: FixAction[]
  summary?: Record<string, unknown>
  system_info?: Record<string, unknown>
}

// Doctor result shape: { name, status: "pass"|"fail", detail, category, fixable }
interface DoctorResult {
  name: string
  status: string
  detail?: string
  category?: string
  fixable?: boolean
}

// Install result shape: { time, level: "info"|"warn"|"fail"|"skip", step, detail, ... }
interface InstallResult {
  time?: string
  level: string
  step: string
  detail?: string
  command?: string
  error?: string
}

interface ExtractedFailure {
  pattern_key: string
  failure_name: string
  category: string | null
}

// =============================================
// Pattern Detection Helpers
// =============================================

/**
 * Extract failures from results JSONB based on event type.
 * Doctor: items with status === "fail"
 * Install: items with level === "fail"
 */
function extractFailures(eventType: string, results: unknown): ExtractedFailure[] {
  if (!Array.isArray(results)) return []

  const failures: ExtractedFailure[] = []

  if (eventType === 'doctor') {
    for (const item of results as DoctorResult[]) {
      if (item.status === 'fail' && item.name) {
        const category = item.category || 'unknown'
        const nameSafe = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
        failures.push({
          pattern_key: `doctor:${category}:${nameSafe}`,
          failure_name: item.name,
          category,
        })
      }
    }
  } else if (eventType === 'install') {
    for (const item of results as InstallResult[]) {
      if (item.level === 'fail' && item.step) {
        const step = item.step.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
        const detailSnip = (item.detail || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .slice(0, 20)
        failures.push({
          pattern_key: `install:${step}:${detailSnip}`,
          failure_name: `${item.step}: ${item.detail || 'unknown'}`,
          category: item.step,
        })
      }
    }
  }

  return failures
}

// =============================================
// POST /api/telemetry/report
// =============================================

export async function POST(request: NextRequest) {
  // Validate bearer token
  const authHeader = request.headers.get('authorization')
  const expectedKey = process.env.TELEMETRY_API_KEY

  if (!expectedKey) {
    console.error('[Telemetry API] TELEMETRY_API_KEY environment variable not set')
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500, headers: corsHeaders }
    )
  }

  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i)
  if (!bearerMatch || !secureCompare(bearerMatch[1], expectedKey)) {
    return NextResponse.json(
      { error: 'Invalid or missing authorization' },
      { status: 401, headers: corsHeaders }
    )
  }

  try {
    const body: TelemetryRequest = await request.json()

    // Validate required fields
    if (!body.event_type || !['doctor', 'install'].includes(body.event_type)) {
      return NextResponse.json(
        { error: 'event_type must be "doctor" or "install"' },
        { status: 400, headers: corsHeaders }
      )
    }

    if (!body.results) {
      return NextResponse.json(
        { error: 'results field is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Build fix_summary from fix_actions if present
    const fixSummary: FixSummary | null = body.fix_actions && body.fix_actions.length > 0
      ? {
          fixes_attempted: body.fix_actions.length,
          fixes_succeeded: body.fix_actions.filter(fa => fa.success === true).length,
          fixes_failed: body.fix_actions.filter(fa => fa.success === false).length,
        }
      : (body.summary?.fixes_attempted != null
          ? {
              fixes_attempted: Number(body.summary.fixes_attempted),
              fixes_succeeded: Number(body.summary.fixes_succeeded ?? 0),
              fixes_failed: Number(body.summary.fixes_failed ?? 0),
            }
          : null)

    // Resolve cloud user from install token if provided
    let cloudUserId: string | null = null
    if (body.install_token) {
      const [installRecord] = await db
        .select({ clerkUserId: userInstalls.clerkUserId })
        .from(userInstalls)
        .where(eq(userInstalls.installToken, body.install_token))
        .limit(1)

      if (installRecord) {
        cloudUserId = installRecord.clerkUserId
      }
    }

    const row = {
      eventType: body.event_type,
      platform: body.platform || null,
      arch: body.arch || null,
      osVersion: body.os_version || null,
      bunVersion: body.bun_version || null,
      oneVersion: body.one_version || null,
      principalName: body.principal_name || null,
      cloudUserId,
      installToken: body.install_token || null,
      results: body.results,
      summary: body.summary || null,
      systemInfo: body.system_info || null,
      fixActions: body.fix_actions || null,
      fixSummary,
    }

    const [inserted] = await db
      .insert(telemetryEvents)
      .values(row)
      .returning({ id: telemetryEvents.id })

    if (!inserted) {
      console.error('[Telemetry API] Insert returned no rows')
      return NextResponse.json(
        { success: false, error: 'Insert failed' },
        { status: 500, headers: corsHeaders }
      )
    }

    // =============================================
    // Link install to cloud user
    // =============================================

    if (body.install_token && cloudUserId) {
      const isDoctor = body.event_type === 'doctor'
      const doctorPassed = isDoctor && body.summary &&
        (body.summary as Record<string, number>).fail === 0

      await db
        .update(userInstalls)
        .set({
          status: doctorPassed ? 'verified' : 'connected',
          platform: body.platform || null,
          arch: body.arch || null,
          osVersion: body.os_version || null,
          bunVersion: body.bun_version || null,
          oneVersion: body.one_version || null,
          principalName: body.principal_name || null,
          connectedAt: new Date(),
          ...(doctorPassed ? { verifiedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(userInstalls.installToken, body.install_token))
    }

    // =============================================
    // Auto-pattern detection
    // =============================================

    const knownFixes: { failure: string; fix: string }[] = []

    const failures = extractFailures(body.event_type, body.results)

    if (failures.length > 0) {
      const now = new Date()

      // Upsert each failure pattern
      for (const failure of failures) {
        // Try to fetch existing pattern first
        const [existing] = await db
          .select({
            id: telemetryFailurePatterns.id,
            occurrenceCount: telemetryFailurePatterns.occurrenceCount,
            knownFix: telemetryFailurePatterns.knownFix,
          })
          .from(telemetryFailurePatterns)
          .where(eq(telemetryFailurePatterns.patternKey, failure.pattern_key))
          .limit(1)

        if (existing) {
          // Increment count and update last_seen
          await db
            .update(telemetryFailurePatterns)
            .set({
              occurrenceCount: (existing.occurrenceCount || 0) + 1,
              lastSeen: now,
              updatedAt: now,
            })
            .where(eq(telemetryFailurePatterns.id, existing.id))

          // Collect known fix if available
          if (existing.knownFix) {
            knownFixes.push({
              failure: failure.failure_name,
              fix: existing.knownFix,
            })
          }
        } else {
          // Insert new pattern
          await db
            .insert(telemetryFailurePatterns)
            .values({
              patternKey: failure.pattern_key,
              failureName: failure.failure_name,
              category: failure.category,
              occurrenceCount: 1,
              firstSeen: now,
              lastSeen: now,
              updatedAt: now,
            })
        }
      }
    }

    // =============================================
    // Auto-populate known fixes from successful fix_actions
    // =============================================

    if (body.fix_actions && body.fix_actions.length > 0) {
      for (const fa of body.fix_actions) {
        if (fa.success && fa.action_taken) {
          const category = fa.category || 'unknown'
          const nameSafe = fa.check_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
          const patternKey = `doctor:${category}:${nameSafe}`

          // Look up matching pattern in telemetry_failure_patterns
          const [pattern] = await db
            .select({
              id: telemetryFailurePatterns.id,
              knownFix: telemetryFailurePatterns.knownFix,
            })
            .from(telemetryFailurePatterns)
            .where(eq(telemetryFailurePatterns.patternKey, patternKey))
            .limit(1)

          // If pattern exists and has no known_fix yet, teach it
          if (pattern && !pattern.knownFix) {
            await db
              .update(telemetryFailurePatterns)
              .set({
                knownFix: fa.action_taken,
                updatedAt: new Date(),
              })
              .where(eq(telemetryFailurePatterns.id, pattern.id))
          }
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
        id: inserted.id,
        known_fixes: knownFixes.length > 0 ? knownFixes : undefined,
      },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('[Telemetry API] Unexpected error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
