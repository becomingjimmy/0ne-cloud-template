import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

// Guard: this module may be imported client-side (for type re-exports).
// Only initialize the connection on the server where env vars exist.
const url = process.env.NEON_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
const sql = url ? neon(url) : undefined
export const db = sql ? drizzle(sql, { schema }) : undefined as unknown as ReturnType<typeof drizzle<typeof schema>>
export type Db = typeof db

// Re-export Drizzle utilities for convenience
export { eq, ne, gt, gte, lt, lte, and, or, not, inArray, isNull, isNotNull, desc, asc, count, sql as rawSql, ilike, like, between, arrayContains, arrayOverlaps } from 'drizzle-orm'
export * from './schema'
