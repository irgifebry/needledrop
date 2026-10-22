import type { MetadataRoute } from 'next'

/**
 * Web app manifest. The app is a PWA in the sense that it has an installable
 * shell; the service worker itself is a later milestone (PLAN §30).
 */

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'needledrop',
    short_name: 'needledrop',
    description: 'Drop the needle on one track. Get the whole session.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0b0b',
    theme_color: '#ff6831',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}