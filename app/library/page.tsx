import type { Metadata } from 'next'

import { LibraryView } from '@/components/library/library-view'
import { ScrollToTop } from '@/components/scroll-to-top'
import { SiteFooter } from '@/components/sections/footer'

/**
 * The library — a view of the playlists on the signed-in user's own YouTube
 * account, with the ones NeedleDrop made marked as such.
 *
 * The page is a server component so the signed-out state can be rendered
 * without a fetch: it decides whether there is a session and hands that
 * boolean to the client island, which does the rest.
 */

export const metadata: Metadata = {
  title: 'YouTube Library · needledrop',
  description: 'View and manage playlists on your YouTube account, including playlists created with needledrop.',
  alternates: { canonical: '/library' },
}

// `getAuthSession` is not a real helper — resolve the session locally so the
// page stays a server component and never leaks the token to the client.
async function readSignedIn(): Promise<boolean> {
  try {
    const { cookies } = await import('next/headers')
    const store = await cookies()
    const raw = store.get('needledrop_session')?.value
    return Boolean(raw)
  } catch {
    return false
  }
}

export default async function LibraryPage() {
  const signedIn = await readSignedIn()

  return (
    <>
      <ScrollToTop />
      <main className="bg-paper text-ink">
        <section data-chapter="ink" className="bg-ink text-paper">
          <div className="shell pt-[calc(4.5rem_+_6svh)] pb-[6svh]">
            <p className="t-small uppercase tracking-widest text-paper/60">Library</p>
            <h1 className="display t-mega mt-4 leading-[0.9]">Your YouTube playlists.</h1>
            <p className="t-lead mt-6 max-w-[60ch] text-paper/75">
              This library manages playlists on your YouTube account, with the ones made here marked
              as such. Open one to rename, reorder, trim or delete it. Google sign-in is needed only
              to use this YouTube library.
            </p>
          </div>
        </section>

        <section className="bg-paper text-ink">
          <div className="shell py-[6svh]">
            <LibraryView signedIn={signedIn} />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
