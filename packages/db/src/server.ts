import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

const url = process.env.NEON_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!url) throw new Error('Missing database URL: set NEON_POSTGRES_URL, POSTGRES_URL, or DATABASE_URL')
const sql = neon(url)
export const db = drizzle(sql, { schema })
export type Db = typeof db

// Re-export Drizzle utilities for convenience
export { eq, ne, gt, gte, lt, lte, and, or, not, inArray, isNull, isNotNull, desc, asc, count, sql as rawSql, ilike, like, between, arrayContains, arrayOverlaps } from 'drizzle-orm'
export * from './schema'
