import { Badge } from '@/components/ui/badge'
import type { PlaylistPrivacy } from '@/lib/youtube/types'

/**
 * The privacy of a playlist, as one word.
 *
 * `public` is the risky one: a public playlist is indexed and reachable by
 * anyone, and publishing is effectively irreversible in practice. The badge
 * uses the mint accent for private/unlisted (the safe default) and orange
 * for public, so the dangerous state is the one that stands out.
 */

export function PrivacyBadge({ privacy }: { privacy: PlaylistPrivacy }) {
  const tone =
    privacy === 'public'
      ? 'text-orange'
      : privacy === 'unlisted'
        ? 'text-ink/70'
        : 'text-mint'

  return (
    <Badge className={tone}>
      {privacy === 'private'
        ? 'Private'
        : privacy === 'unlisted'
          ? 'Unlisted'
          : 'Public'}
    </Badge>
  )
}