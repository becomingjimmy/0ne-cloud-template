/**
 * Staff Users API
 *
 * CRUD operations for managing staff users in the DM sync system.
 * Enables multi-staff support with proper message attribution.
 *
 * GET /api/settings/staff-users - List all staff users
 * POST /api/settings/staff-users - Create a new staff user
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { safeErrorResponse } from '@/lib/security'
import {
  getStaffUsers,
  createStaffUser,
  type StaffUserInput,
} from '@/features/dm-sync/lib/staff-users'

export const dynamic = 'force-dynamic'

/**
 * GET /api/settings/staff-users
 * List all staff users for the current account
 */
export async function GET() {
  try {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const staffUsers = await getStaffUsers(userId)

    return NextResponse.json({
      success: true,
      data: staffUsers,
      count: staffUsers.length,
    })
  } catch (error) {
    console.error('[Staff Users API] GET error:', error)
    return safeErrorResponse('Failed to fetch staff users', error)
  }
}

/**
 * POST /api/settings/staff-users
 * Create a new staff user
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    // Validate required fields
    if (!body.skoolUserId?.trim()) {
      return NextResponse.json(
        { error: 'Missing required field: skoolUserId' },
        { status: 400 }
      )
    }

    if (!body.displayName?.trim()) {
      return NextResponse.json(
        { error: 'Missing required field: displayName' },
        { status: 400 }
      )
    }

    const input: StaffUserInput = {
      userId,
      skoolUserId: body.skoolUserId.trim(),
      skoolUsername: body.skoolUsername?.trim() || undefined,
      displayName: body.displayName.trim(),
      ghlUserId: body.ghlUserId?.trim() || undefined,
      isDefault: body.isDefault === true,
      isActive: body.isActive !== false,
    }

    const staffUser = await createStaffUser(input)

    return NextResponse.json({
      success: true,
      data: staffUser,
    })
  } catch (error) {
    console.error('[Staff Users API] POST error:', error)

    // Handle unique constraint violation
    if (
      error instanceof Error &&
      error.message.includes('duplicate key')
    ) {
      return NextResponse.json(
        { error: 'A staff user with this Skool ID already exists' },
        { status: 409 }
      )
    }

    return safeErrorResponse('Failed to create staff user', error)
  }
}
