/**
 * Send Pending DMs Cron Endpoint
 *
 * DISABLED: Server-side Skool API calls are blocked by AWS WAF (discovered 2026-02-14).
 * All outbound DM sending now goes through the Chrome extension, which polls
 * GET /api/extension/get-pending and sends via the browser's authenticated session.
 *
 * This cron previously called sendPendingMessages() which tried server-side Skool API
 * calls. Since AWS WAF blocks those, every message was marked 'failed' - racing the
 * extension and corrupting the pending queue.
 *
 * The cron entry remains in vercel.json as a no-op to avoid deployment errors.
 * Messages stay 'pending' until the extension picks them up and confirms via
 * POST /api/extension/confirm-sent.
 */

import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 10

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // No-op: Extension handles all outbound Skool DM delivery.
  // Server-side Skool API calls are blocked by AWS WAF.
  console.log('[send-pending-dms] No-op - extension handles outbound delivery')

  return NextResponse.json({
    success: true,
    message: 'No-op: outbound DMs handled by Chrome extension. Server-side Skool API blocked by AWS WAF.',
    duration: '0.0s',
  })
}
