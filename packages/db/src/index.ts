// Database package exports (client-safe: types + schema only, no db/neon)
// Server code: import { db, eq, ... } from '@0ne/db/server'
// Client code: import { type Contact, ... } from '@0ne/db'
export * from './types'
export * from './schema'
