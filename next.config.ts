import type { NextConfig } from 'next'

const isDev = process.env.NODE_ENV !== 'production'

/**
 * Content Security Policy (PLAN §13.10, §13.11).
 *
 * The app is metadata-only: it loads thumbnails from `i.ytimg.com`, talks to
 * the YouTube Data API from the server (never from the browser), and may
 * embed a YouTube player later. Nothing else is allowed.
 *
 * `script-src` needs `'unsafe-inline'` because `app/layout.tsx` ships a tiny
 * inline script that marks the document as script-capable before hydration
 * (without it, content stays visible when JavaScript fails). A nonce-based
 * policy would remove that exception; it is the next hardening step, not
 * something to bolt on while the app is still moving.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://i.ytimg.com https://yt3.ggpht.com https://picsum.photos",
  "font-src 'self' data:",
  "connect-src 'self' https://www.googleapis.com https://*.upstash.io",
  "media-src 'self' https://www.youtube.com https://*.googlevideo.com",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://music.youtube.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  ...(isDev
    ? []
    : [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]),
]

const nextConfig: NextConfig = {
  reactCompiler: false,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'yt3.ggpht.com' },
      { protocol: 'https', hostname: 'picsum.photos' },
    ],
    qualities: [75],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // API responses are never cacheable: quota numbers and playlists
        // change, and a stale answer would be a lie.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
      {
        // The SSE stream needs the opposite: it must not be buffered or
        // transformed by a proxy. Listed after the rule above so it wins
        // for this path.
        source: '/api/jobs/:id/stream',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-transform' },
          { key: 'Connection', value: 'keep-alive' },
          { key: 'X-Accel-Buffering', value: 'no' },
        ],
      },
    ]
  },
}

export default nextConfig
