/**
 * Quota model (PLAN §5).
 *
 * The YouTube Data API charges per request, not per result, and the numbers
 * below are the ones that matter: `search.list` is the expensive call and
 * `playlistItems.insert` is charged per item.
 */

export const DAILY_QUOTA = 10_000

export const UNIT_COST = {
  search: 100,
  videosList: 1,
  playlistItemsList: 1,
  playlistsList: 1,
  playlistsInsert: 50,
  playlistsUpdate: 50,
  playlistsDelete: 50,
  playlistItemsInsert: 50,
  playlistItemsUpdate: 50,
  playlistItemsDelete: 50,
  channelsList: 1,
  liveBroadcastsList: 1,
  activitiesList: 1,
  subscriptionsList: 1,
  videoCategoriesList: 1,
} as const

export function estimateDiscoveryUnits(searches = 4, videoCalls = 2): number {
  return searches * UNIT_COST.search + videoCalls * UNIT_COST.videosList
}

export function estimatePlaylistUnits(trackCount: number): number {
  return UNIT_COST.playlistsInsert + trackCount * UNIT_COST.playlistItemsInsert
}

export function quotaTone(used: number): 'safe' | 'warn' | 'danger' {
  if (used >= 7_000) return 'danger'
  if (used >= 3_000) return 'warn'
  return 'safe'
}

export function formatUnits(units: number): string {
  return units.toLocaleString('en-US')
}
