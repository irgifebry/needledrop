import type { Metadata } from 'next'

import { ApiKeyPanel } from '@/components/settings/api-key-panel'
import { ScrollToTop } from '@/components/scroll-to-top'
import { BlocksPanel } from '@/components/settings/blocks-panel'
import { DataPanel } from '@/components/settings/data-panel'
import { PresetsPanel } from '@/components/settings/presets-panel'
import { QuotaPanel } from '@/components/settings/quota-panel'
import { SiteFooter } from '@/components/sections/footer'

/**
 * Settings for the search budget, the visitor's own YouTube API key,
 * the blocklist, presets and data controls.
 */

export const metadata: Metadata = {
  title: 'Settings · needledrop',
  description: 'Manage your search budget, YouTube API key, blocks, presets and data.',
  alternates: { canonical: '/settings' },
}

export default function SettingsPage() {
  return (
    <>
      <ScrollToTop />
      <main className="bg-paper text-ink">
        <section data-chapter="ink" className="bg-ink text-paper">
          <div className="shell page-hero-content">
            <p className="t-small uppercase tracking-widest text-paper/60">Settings</p>
            <h1 className="display t-mega mt-4 leading-[0.9]">The controls.</h1>
            <p className="t-lead mt-6 max-w-[60ch] text-paper/75">
              Manage search costs, your YouTube API key, the blocklist, saved setups and your data.
              Search and playlist generation need no sign-in; Google sign-in is only needed when
              saving a playlist to YouTube Music.
            </p>
          </div>
        </section>

        <section data-chapter="paper" className="bg-paper text-ink">
          <div className="shell py-[6svh] space-y-12">
            <section>
              <h2 className="display t-headline leading-none">Budget</h2>
              <div className="mt-6">
                <QuotaPanel />
              </div>
            </section>

            <section>
              <h2 className="display t-headline leading-none">Your YouTube API key</h2>
              <div className="mt-6">
                <ApiKeyPanel />
              </div>
            </section>

            <section>
              <h2 className="display t-headline leading-none">Blocklist</h2>
              <div className="mt-6">
                <BlocksPanel />
              </div>
            </section>

            <section>
              <h2 className="display t-headline leading-none">Presets</h2>
              <div className="mt-6">
                <PresetsPanel />
              </div>
            </section>

            <section>
              <h2 className="display t-headline leading-none">Your data</h2>
              <div className="mt-6">
                <DataPanel />
              </div>
            </section>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
