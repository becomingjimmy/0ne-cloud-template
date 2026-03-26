import { or, inArray, isNull } from '@0ne/db/server'
import { skoolMembers } from '@0ne/db/server'

/**
 * Build a Drizzle where clause for attribution source filtering on skool_members.
 * Handles the 'unknown'/'null' pseudo-source by mapping to IS NULL.
 */
export function buildSourceFilter(sources: string[]) {
  const includesUnknown = sources.includes('unknown') || sources.includes('null')
  const regularSources = sources.filter(s => s !== 'unknown' && s !== 'null')

  if (includesUnknown && regularSources.length > 0) {
    return or(inArray(skoolMembers.attributionSource, regularSources), isNull(skoolMembers.attributionSource))
  } else if (includesUnknown) {
    return isNull(skoolMembers.attributionSource)
  } else {
    return inArray(skoolMembers.attributionSource, regularSources)
  }
}
