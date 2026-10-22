export type SpotifyTrack = {
  id: string
  title: string
  artist: string
  album: string
  durationMs: number
  spotifyUrl: string
  previewUrl?: string
  imageUrl?: string
}

export type SpotifyPlaylist = {
  id: string
  name: string
  description?: string
  trackCount: number
  spotifyUrl: string
  owner?: string
}
