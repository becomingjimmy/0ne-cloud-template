'use client'

import { useState, useEffect, useCallback } from 'react'

// =============================================================================
// TYPES
// =============================================================================

export interface PersonalExpenseCategoryData {
  id: string
  name: string
  slug: string
  color: string | null
  description: string | null
  display_order: number
  created_at: string
  updated_at: string
  expenseCount: number
}

export interface PersonalExpenseCategoriesResponse {
  categories: PersonalExpenseCategoryData[]
  total: number
}

export interface CreatePersonalCategoryInput {
  name: string
  color?: string
  description?: string
}

export interface UpdatePersonalCategoryInput {
  id: string
  name?: string
  color?: string
  description?: string
}

interface UsePersonalExpenseCategoriesReturn {
  categories: PersonalExpenseCategoryData[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

interface MutationResult<T = unknown> {
  success: boolean
  category?: T
  error?: string
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook for fetching personal expense categories
 */
export function usePersonalExpenseCategories(): UsePersonalExpenseCategoriesReturn {
  const [categories, setCategories] = useState<PersonalExpenseCategoryData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/personal/expense-categories')
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch categories')
      }
      const data: PersonalExpenseCategoriesResponse = await response.json()
      setCategories(data.categories)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { categories, isLoading, error, refetch: fetchData }
}

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Create a new personal expense category
 */
export async function createPersonalCategory(
  input: CreatePersonalCategoryInput
): Promise<MutationResult<PersonalExpenseCategoryData>> {
  try {
    const response = await fetch('/api/personal/expense-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })

    const data = await response.json()

    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to create category' }
    }

    return { success: true, category: data.category }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create category',
    }
  }
}

/**
 * Update an existing personal expense category
 */
export async function updatePersonalCategory(
  input: UpdatePersonalCategoryInput
): Promise<MutationResult<PersonalExpenseCategoryData>> {
  try {
    const response = await fetch('/api/personal/expense-categories', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })

    const data = await response.json()

    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to update category' }
    }

    return { success: true, category: data.category }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update category',
    }
  }
}

/**
 * Delete a personal expense category
 */
export async function deletePersonalCategory(id: string): Promise<MutationResult> {
  try {
    const response = await fetch(`/api/personal/expense-categories?id=${id}`, {
      method: 'DELETE',
    })

    const data = await response.json()

    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to delete category' }
    }

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete category',
    }
  }
}
