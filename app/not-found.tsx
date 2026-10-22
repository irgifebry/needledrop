import type { Metadata } from 'next'

import { ButtonLink } from '@/components/ui/button'
import { SiteFooter } from '@/components/sections/footer'

/**
 * The 404 page.
 *
 * Next.js renders this for any URL that does not match a route. It matters
 * more here than it usually does: the app takes YouTube links as input, and
 * a pasted link that gets mangled — a stripped `?v=`, a short URL the app
 * cannot parse — is exactly the kind of thing that lands here. So the page
 * says what went wrong in plain words and points back at the thing the
 * visitor was trying to do, instead of showing a bare status code.
 */

export const metadata: Metadata = {
  title: 'Not found · needledrop',
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return (
    <>
      <main className="bg-paper text-ink">
        <section data-chapter="orange" className="min-h-[70svh] bg-orange text-ink">
          <div className="shell flex min-h-[70svh] flex-col justify-end py-[6svh]">
            <p className="t-small uppercase tracking-widest opacity-70">Error 404</p>
            <h1 className="display t-mega mt-4 max-w-[16ch] leading-[0.9]">
              That link went nowhere.
            </h1>
            <p className="t-lead mt-6 max-w-[52ch] leading-relaxed">
              The page you asked for is not here. If you pasted a YouTube link, it may have been
              truncated — the video id is the eleven characters after <code>v=</code>, and a{' '}
              <code>youtu.be</code> link needs the part after the slash.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/" size="lg">
                Back to the generator
              </ButtonLink>
              <ButtonLink href="/library" variant="outline" size="lg">
                Open my library
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
