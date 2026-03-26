'use client'

import { useState, useEffect, useCallback } from 'react'

// =============================================================================
// TYPES
// =============================================================================

export interface PersonalExpensesSummary {
  totalExpenses: number
  monthlyBurnRate: number
  categoryCount: number
  activeExpenses: number
}

export interface PersonalExpenseCategory {
  id: string
  name: string
  amount: number
  change: number
  trend: 'up' | 'down' | 'neutral'
  color: string
}

export interface PersonalMonthlyData {
  month: string
  total: number
  byCategory: Record<string, number>
}

export interface PersonalExpenseItem {
  id: string
  name: string
  category: string
  amount: number
  frequency: string
  isActive: boolean
  expenseDate: string
  notes: string | null
}

export interface PersonalExpensesData {
  summary: PersonalExpensesSummary
  categories: PersonalExpenseCategory[]
  monthly: PersonalMonthlyData[]
  expenses: PersonalExpenseItem[]
  period: { startDate: string; endDate: string; label: string }
}

interface UsePersonalExpensesReturn {
  data: PersonalExpensesData | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

// =============================================================================
// HELPERS
// =============================================================================

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

// =============================================================================
// HOOK
// =============================================================================

export function usePersonalExpenses(options: {
  dateRange?: { from: Date; to: Date } | undefined
  period?: string
  category?: string | null
} = {}): UsePersonalExpensesReturn {
  const { dateRange, period = 'mtd', category = null } = options
  const [data, setData] = useState<PersonalExpensesData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Memoize date strings
  const startDate = dateRange ? formatDate(dateRange.from) : undefined
  const endDate = dateRange ? formatDate(dateRange.to) : undefined

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const url = new URL('/api/personal/expenses', window.location.origin)

      if (startDate) url.searchParams.set('startDate', startDate)
      if (endDate) url.searchParams.set('endDate', endDate)
      if (!startDate) url.searchParams.set('period', period)
      if (category) url.searchParams.set('category', category)

      const response = await fetch(url.toString())
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `API error: ${response.status}`)
      }

      const result: PersonalExpensesData = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [startDate, endDate, period, category])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Add a new personal expense
 */
export async function addPersonalExpense(expense: {
  description: string
  amount: number
  category: string
  expense_date: string
  frequency?: string
  notes?: string
}): Promise<{ success: boolean; expense?: Record<string, unknown>; error?: string }> {
  const response = await fetch('/api/personal/expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(expense),
  })

  const data = await response.json()
  if (!response.ok) {
    return { success: false, error: data.error || 'Failed to add expense' }
  }
  return data
}

/**
 * Update an existing personal expense
 */
export async function updatePersonalExpense(expense: {
  id: string
  description: string
  amount: number
  category: string
  frequency?: string
  expense_date?: string
  notes?: string
}): Promise<{ success: boolean; expense?: Record<string, unknown>; error?: string }> {
  const response = await fetch('/api/personal/expenses', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(expense),
  })

  const data = await response.json()
  if (!response.ok) {
    return { success: false, error: data.error || 'Failed to update expense' }
  }
  return data
}

/**
 * Toggle active status on a personal expense
 */
export async function togglePersonalExpense(id: string, is_active: boolean): Promise<{ success: boolean; expense?: Record<string, unknown>; error?: string }> {
  const response = await fetch('/api/personal/expenses', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, is_active }),
  })

  const data = await response.json()
  if (!response.ok) {
    return { success: false, error: data.error || 'Failed to toggle expense' }
  }
  return data
}

/**
 * Delete a personal expense by ID
 */
export async function deletePersonalExpense(id: string): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`/api/personal/expenses?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })

  const data = await response.json()
  if (!response.ok) {
    return { success: false, error: data.error || 'Failed to delete expense' }
  }
  return data
}
