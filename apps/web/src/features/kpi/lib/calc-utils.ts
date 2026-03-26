export function calculateChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

export function determineTrend(change: number): 'up' | 'down' | 'neutral' {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'neutral'
}

/**
 * Sum a numeric field across an array of records.
 * Non-numeric values are treated as 0.
 */
export function sumField<T extends Record<string, unknown>>(rows: T[], field: keyof T & string): number {
  return rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0)
}
