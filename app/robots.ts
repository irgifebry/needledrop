import type { MetadataRoute } from 'next'

/**
 * Robots policy.
 *
 * The app is public and indexable, but the API routes and the privacy page's
 * delete controls are not. The API is no-store anyway, so allowing crawlers
 * there would only waste their time.
 */

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/library/', '/settings/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}