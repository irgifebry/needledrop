import type { Metadata } from 'next'

import { PlaylistEditor } from '@/components/library/playlist-editor'
import { SiteFooter } from '@/components/sections/footer'

/**
 * One playlist, editable.
 *
 * Next 16 makes `params` a Promise, so the page awaits it before rendering.
 * The editor itself is a client component because every action is a mutation.
 */

export const metadata: Metadata = {
  title: 'Edit YouTube Playlist · needledrop',
  description: 'Edit a playlist on your YouTube account. Sign in with Google to access this YouTube library.',
  alternates: { canonical: '/library' },
}

export default async function PlaylistPage({
  params,
}: {
  params: Promise<{ playlistId: string }>
}) {
  const { playlistId } = await params

  return (
    <>
      <main className="bg-paper text-ink">
        <section data-chapter="ink" className="bg-ink text-paper">
          <div className="shell pt-[calc(4.5rem_+_6svh)] pb-[6svh]">
            <p className="t-small uppercase tracking-widest text-paper/60">Library</p>
            <h1 className="display t-mega mt-4 leading-[0.9]">Edit your YouTube playlist.</h1>
            <p className="t-lead mt-6 max-w-[60ch] text-paper/75">
              This page edits a playlist on your YouTube account. Sign in with Google to access it
              here; this sign-in is for YouTube library management, not a requirement for the whole
              app. Rename, reorder or trim tracks, with the YouTube quota cost shown next to each
              action.
            </p>
          </div>
        </section>

        <section className="bg-paper text-ink">
          <div className="shell py-[6svh]">
            <PlaylistEditor playlistId={playlistId} />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
