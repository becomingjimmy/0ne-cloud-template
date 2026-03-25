import { customType } from 'drizzle-orm/pg-core'

interface NumericNumberConfig {
  precision?: number
  scale?: number
}

/**
 * Numeric column that returns JavaScript `number` instead of `string`.
 *
 * Drizzle's built-in `numeric()` returns strings because JS can't represent
 * all DECIMAL values precisely. For our use case (financial metrics with
 * precision <= 12, scale <= 4), Number is safe and eliminates hundreds of
 * manual Number() casts throughout the codebase.
 *
 * Generates identical SQL to `numeric()` — zero migration impact.
 */
export const numericNumber = customType<{
  data: number
  driverData: string
  config: NumericNumberConfig
}>({
  dataType(config) {
    if (config?.precision != null && config?.scale != null) {
      return `numeric(${config.precision}, ${config.scale})`
    }
    if (config?.precision != null) {
      return `numeric(${config.precision})`
    }
    return 'numeric'
  },
  fromDriver(value: string): number {
    return Number(value)
  },
  toDriver(value: number): string {
    return String(value)
  },
})
