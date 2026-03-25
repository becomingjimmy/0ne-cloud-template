import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, asc } from '@0ne/db/server'
import { plaidCategoryMappings } from '@0ne/db/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const mappings = await db.select()
      .from(plaidCategoryMappings)
      .orderBy(asc(plaidCategoryMappings.plaidPrimary))

    return NextResponse.json({ mappings })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch mappings', details: String(error) },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { plaid_primary, plaid_detailed, expense_category_slug } = body

    if (!plaid_primary || !expense_category_slug) {
      return NextResponse.json(
        { error: 'Missing required fields: plaid_primary, expense_category_slug' },
        { status: 400 }
      )
    }

    const [mapping] = await db.insert(plaidCategoryMappings).values({
      plaidPrimary: plaid_primary,
      plaidDetailed: plaid_detailed || null,
      expenseCategorySlug: expense_category_slug,
    }).onConflictDoUpdate({
      target: [plaidCategoryMappings.plaidPrimary, plaidCategoryMappings.plaidDetailed],
      set: {
        expenseCategorySlug: expense_category_slug,
      },
    }).returning()

    return NextResponse.json({ success: true, mapping })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save mapping', details: String(error) },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Missing required query parameter: id' },
        { status: 400 }
      )
    }

    await db.delete(plaidCategoryMappings)
      .where(eq(plaidCategoryMappings.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete mapping', details: String(error) },
      { status: 500 }
    )
  }
}
