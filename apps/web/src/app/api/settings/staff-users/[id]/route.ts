/**
 * Staff Users API - Individual Resource
 *
 * Operations for managing a specific staff user.
 *
 * PUT /api/settings/staff-users/[id] - Update a staff user
 * DELETE /api/settings/staff-users/[id] - Delete a staff user
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { safeErrorResponse } from '@/lib/security'
import {
  updateStaffUser,
  deleteStaffUser,
} from '@/features/dm-sync/lib/staff-users'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * PUT /api/settings/staff-users/[id]
 * Update a staff user
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()

    // Build updates object
    const updates: Record<string, unknown> = {}

    if (body.skoolUsername !== undefined) {
      updates.skoolUsername = body.skoolUsername?.trim() || null
    }

    if (body.displayName !== undefined) {
      if (!body.displayName?.trim()) {
        return NextResponse.json(
          { error: 'displayName cannot be empty' },
          { status: 400 }
        )
      }
      updates.displayName = body.displayName.trim()
    }

    if (body.ghlUserId !== undefined) {
      updates.ghlUserId = body.ghlUserId?.trim() || null
    }

    if (body.isDefault !== undefined) {
      updates.isDefault = body.isDefault === true
    }

    if (body.isActive !== undefined) {
      updates.isActive = body.isActive === true
    }

    const staffUser = await updateStaffUser(id, updates)

    return NextResponse.json({
      success: true,
      data: staffUser,
    })
  } catch (error) {
    console.error('[Staff Users API] PUT error:', error)
    return safeErrorResponse('Failed to update staff user', error)
  }
}

/**
 * DELETE /api/settings/staff-users/[id]
 * Delete a staff user
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    await deleteStaffUser(id)

    return NextResponse.json({
      success: true,
      deleted: true,
    })
  } catch (error) {
    console.error('[Staff Users API] DELETE error:', error)
    return safeErrorResponse('Failed to delete staff user', error)
  }
}
