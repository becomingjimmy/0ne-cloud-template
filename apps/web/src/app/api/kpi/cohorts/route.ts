import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, eq, gte, lte, and, or, inArray, isNull, asc } from '@0ne/db/server'
import { contacts, skoolMembers, cohortSnapshots, ghlTransactions } from '@0ne/db/server'
import { COHORT_DAYS, type CohortDay } from '@/features/kpi/lib/config'

export const dynamic = 'force-dynamic'

interface CohortRow {
  cohort: string
  startDate: string
  initialLeads: number
  progression: Record<CohortDay, {
    leads: number
    epl: number
    ltv: number
  }>
}

// Get the week number for a date
function getWeekNumber(date: Date): string {
  const year = date.getFullYear()
  const firstDay = new Date(year, 0, 1)
  const dayOfYear = Math.floor((date.getTime() - firstDay.getTime()) / 86400000) + 1
  const weekNum = Math.ceil(dayOfYear / 7)
  return `${year}-W${String(weekNum).padStart(2, '0')}`
}

// Get start of week (Monday)
function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  return new Date(d.setDate(diff))
}

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const source = searchParams.get('source') || null
    // Support multiple sources via comma-separated string (attribution sources from skool_members)
    const sourcesParam = searchParams.get('sources')
    const sources = sourcesParam ? sourcesParam.split(',').filter(Boolean) : []
    const weeksBack = parseInt(searchParams.get('weeks') || '8')

    // Calculate date range
    const now = new Date()
    const startDate = new Date(now)
    startDate.setDate(startDate.getDate() - weeksBack * 7)

    // If sources filter is provided, get matching skool_user_ids from skool_members
    let skoolUserIds: string[] | null = null
    if (sources.length > 0) {
      const hasUnknown = sources.includes('unknown')
      const otherSources = sources.filter(s => s !== 'unknown')

      let sourceFilter
      if (hasUnknown && otherSources.length > 0) {
        sourceFilter = or(inArray(skoolMembers.attributionSource, otherSources), isNull(skoolMembers.attributionSource))
      } else if (hasUnknown) {
        sourceFilter = isNull(skoolMembers.attributionSource)
      } else {
        sourceFilter = inArray(skoolMembers.attributionSource, otherSources)
      }

      const skoolMembersData = await db
        .select({ skoolUserId: skoolMembers.skoolUserId })
        .from(skoolMembers)
        .where(sourceFilter)

      skoolUserIds = skoolMembersData.map(m => m.skoolUserId).filter(Boolean)
    }

    // Get contacts created in the range
    const contactFilters = [
      gte(contacts.createdAt, startDate),
    ]

    // Apply source filter via skool_user_id join (new attribution-based filtering)
    if (skoolUserIds !== null) {
      if (skoolUserIds.length === 0) {
        // No matching skool members, return empty cohorts
        return NextResponse.json({
          cohorts: [],
          overallMetrics: {
            totalLeads: 0,
            averageEpl: 0,
            averageLtv: 0,
            cohortDays: COHORT_DAYS,
          },
          filters: { sources: [], weeksOptions: [4, 8, 12, 16, 24] },
          meta: {
            weeksIncluded: weeksBack,
            startDate: startDate.toISOString().split('T')[0],
            endDate: now.toISOString().split('T')[0],
          },
          sourceFilteringNote: 'No contacts found matching the selected attribution sources.',
        })
      }
      contactFilters.push(inArray(contacts.skoolUserId, skoolUserIds))
    } else if (source) {
      contactFilters.push(eq(contacts.source, source))
    }

    const contactsData = await db
      .select()
      .from(contacts)
      .where(and(...contactFilters))
      .orderBy(asc(contacts.createdAt))

    // Get cohort snapshots if available
    const cohortSnapshotsData = await db
      .select()
      .from(cohortSnapshots)
      .where(gte(cohortSnapshots.createdAt, startDate))
      .orderBy(asc(cohortSnapshots.createdAt))

    // Group contacts by week cohort
    const cohortMap = new Map<string, {
      startDate: Date
      contacts: typeof contactsData
    }>()

    contactsData.forEach((contact) => {
      const createdAt = new Date(contact.createdAt!)
      const weekKey = getWeekNumber(createdAt)
      const weekStart = getWeekStart(createdAt)

      if (!cohortMap.has(weekKey)) {
        cohortMap.set(weekKey, {
          startDate: weekStart,
          contacts: [],
        })
      }
      ;(cohortMap.get(weekKey)!.contacts as typeof contactsData).push(contact)
    })

    // Build cohort progression data
    const cohorts: CohortRow[] = []

    for (const [weekKey, cohortData] of cohortMap) {
      const cohortContacts = (cohortData.contacts || []) as typeof contactsData
      const cohortStartDate = cohortData.startDate

      // Calculate progression for each milestone day
      const progression: CohortRow['progression'] = {} as CohortRow['progression']

      // Get GHL contact IDs for this cohort to query transactions
      const cohortGhlContactIds = cohortContacts
        .map((c) => c.ghlContactId)
        .filter(Boolean) as string[]

      for (const day of COHORT_DAYS) {
        // For each day milestone, count how many leads have reached that age
        const milestoneDate = new Date(cohortStartDate)
        milestoneDate.setDate(milestoneDate.getDate() + day)

        // If milestone is in the future, we don't have data yet
        if (milestoneDate > now) {
          break
        }

        // Count leads that have aged to this point
        const eligibleContacts = cohortContacts.filter((c) => {
          const leadAge = c.leadAge || 0
          return leadAge >= day
        })

        // Calculate EPL by querying ghl_transactions for revenue
        // EPL = Total Revenue within milestone window / Cohort Size
        let totalRevenue = 0
        const cohortSize = cohortContacts.length

        if (cohortGhlContactIds.length > 0) {
          // Query transactions for these contacts up to the milestone date
          const txns = await db
            .select({ amount: ghlTransactions.amount })
            .from(ghlTransactions)
            .where(
              and(
                inArray(ghlTransactions.ghlContactId, cohortGhlContactIds),
                eq(ghlTransactions.status, 'succeeded'),
                lte(ghlTransactions.transactionDate, milestoneDate),
              )
            )

          // Sum up successful transaction amounts
          totalRevenue = txns.reduce((sum, t) => sum + (t.amount || 0), 0)
        }

        // EPL = Total Revenue / Cohort Size (total contacts, not just eligible)
        const avgEpl = cohortSize > 0 ? totalRevenue / cohortSize : 0
        // LTV = EPL for now (MRR attribution is complex - requires subscription tracking)
        const avgLtv = avgEpl

        progression[day] = {
          leads: eligibleContacts.length,
          epl: Math.round(avgEpl * 100) / 100, // Round to 2 decimal places
          ltv: Math.round(avgLtv * 100) / 100,
        }
      }

      cohorts.push({
        cohort: weekKey,
        startDate: cohortStartDate.toISOString().split('T')[0],
        initialLeads: cohortContacts.length,
        progression,
      })
    }

    // Sort cohorts by date (newest first)
    cohorts.sort((a, b) => b.startDate.localeCompare(a.startDate))

    // Calculate overall EPL/LTV averages across all cohorts
    // Average the EPL values from the latest available milestone across all cohorts
    let totalEplSum = 0
    let eplCount = 0
    let totalLtvSum = 0
    let ltvCount = 0

    for (const cohort of cohorts) {
      // Find the highest day milestone with data for this cohort
      const days = Object.keys(cohort.progression).map(Number).sort((a, b) => b - a)
      if (days.length > 0) {
        const latestDay = days[0]
        const latestProgression = cohort.progression[latestDay as keyof typeof cohort.progression]
        if (latestProgression) {
          totalEplSum += latestProgression.epl
          eplCount++
          totalLtvSum += latestProgression.ltv
          ltvCount++
        }
      }
    }

    const overallMetrics = {
      totalLeads: contactsData.length,
      averageEpl: eplCount > 0 ? Math.round((totalEplSum / eplCount) * 100) / 100 : 0,
      averageLtv: ltvCount > 0 ? Math.round((totalLtvSum / ltvCount) * 100) / 100 : 0,
      cohortDays: COHORT_DAYS,
    }

    // Get available sources for filtering
    const sourceSet = new Set<string>()
    contactsData.forEach((c) => {
      if (c.source) sourceSet.add(c.source)
    })

    const response = {
      cohorts,
      overallMetrics,
      filters: {
        sources: Array.from(sourceSet).map((s) => ({ name: s })),
        weeksOptions: [4, 8, 12, 16, 24],
      },
      meta: {
        weeksIncluded: weeksBack,
        startDate: startDate.toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0],
      },
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('KPI Cohorts error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch cohort data', details: String(error) },
      { status: 500 }
    )
  }
}
