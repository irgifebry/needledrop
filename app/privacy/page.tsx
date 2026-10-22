import type { Metadata } from 'next'

import { DataControls } from '@/components/privacy/data-controls'
import { ScrollToTop } from '@/components/scroll-to-top'
import { SiteFooter } from '@/components/sections/footer'
import { Toaster } from '@/components/toaster'

/**
 * The privacy policy.
 *
 * Google requires a publicly reachable privacy policy for any app that reads
 * Google user data, hosted on the same domain as the home page and linked
 * from the OAuth consent screen. It also asks for a Limited Use disclosure
 * naming the app and the policy the app adheres to.
 *
 * The page states only what the code actually does. When the storage layer
 * changes — a database appears, a cookie is added — this page has to change
 * with it, or it becomes a promise the app does not keep.
 */

export const metadata: Metadata = {
  title: 'Privacy · needledrop',
  description:
    'What needledrop reads from Google, why it needs it, what it stores, how long it keeps it, and how to delete all of it.',
  alternates: { canonical: '/privacy' },
}

const SECTIONS: Array<{ heading: string; body: string[]; list?: string[] }> = [
  {
    heading: 'The short version',
    body: [
      'needledrop searches YouTube for tracks and generates playlists from track metadata such as titles, artists, channels, topics and durations. The app does not download or analyze audio.',
      'You can search and generate a playlist without signing in. Google sign-in is needed only when you choose to save a playlist to YouTube Music or use Google-account features.',
    ],
  },
  {
    heading: 'What we access from Google',
    body: [
      'Google sign-in is optional and is used when you choose to save a playlist to YouTube Music or use Google-account features. You can withdraw access at any time from your Google account.',
    ],
    list: [
      'youtube.force-ssl — create and edit playlists in your own account. This is the permission behind the "Create playlist" button.',
      'youtube.readonly — read the playlists and library items the app shows you.',
      'userinfo.email and userinfo.profile — your email address and display name, so the signed-in state can show whose account it is.',
    ],
  },
  {
    heading: 'Why we need them',
    body: [
      'Google playlist and library permissions support the Google-account features shown in the app, including saving playlists to YouTube Music. Google sign-in is not required to search or generate a playlist. YouTube searches use a project API key or, if you provide one, your own YouTube API key.',
      'The app does not request your watch history, subscriptions or likes to generate recommendations. Playlist generation uses track metadata and the tracks and options you provide or select; this is not a profile built from your listening history.',
    ],
  },
  {
    heading: 'What we store',
    body: [
      'Google OAuth tokens, email address and display name are held in the encrypted needledrop_session cookie. It is sealed using AES-256-GCM, marked httpOnly and sameSite=lax, and set Secure in production; it expires after 30 days.',
      'If you provide your own YouTube Data API key, it is stored separately in the encrypted needledrop_apikey cookie, so it remains independent of signing in or out. It is sealed using AES-256-GCM, marked httpOnly and sameSite=lax, and set Secure in production; it expires after 30 days. The key is not sent back to the browser in API responses.',
      'During Google sign-in, a separate httpOnly, sameSite=lax OAuth state cookie is used briefly to validate the sign-in response and is cleared after the callback; it expires after 10 minutes.',
      'Separately, an anonymous identifier named needledrop_anon ties together the things you do without an account: saved presets, blocked tracks, keep/drop feedback and run history. That identifier is a random value in a signed cookie — it is not derived from your email address, your IP address or anything about your device, and it is not linked to your Google account.',
      'If a database is configured, those rows are persisted in it. If no database is configured, they live in the memory of the running process and disappear when the process restarts.',
    ],
  },
  {
    heading: 'What we never do',
    list: [
      'We do not download or analyze audio. Playlist search and generation use metadata.',
      'We do not use Google user data to train a machine-learning model.',
      'We never log an access token, a refresh token or a client secret.',
    ],
    body: [],
  },
  {
    heading: 'How long we keep it',
    body: [
      'The Google session and BYO YouTube API key cookies each have a 30-day lifetime. Signing out of Google attempts to revoke its refresh token before clearing the local cookie. Clearing your YouTube API key removes its separate cookie.',
      'Presets, blocks, feedback and run history are kept until you delete them. There is no other retention schedule and no secondary use.',
    ],
  },
  {
    heading: 'Limited Use disclosure',
    body: [
      'needledrop’s use of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.',
      'Google user data is used to provide the Google-account features you request, such as reading or writing playlists. It is not used for advertising or to train a machine-learning model. Any transfer or use of Google user data is limited to providing or improving the app’s user-facing features, in accordance with the Google API Services User Data Policy and its Limited Use requirements.',
    ],
  },
  {
    heading: 'Who else is involved',
    body: [
      'The app sends search requests to YouTube as needed to find track metadata. When you choose to save a playlist to YouTube Music, the playlist request is sent to Google using your Google authorization. Vercel hosts the site and API. These services are subject to their own privacy policies and terms.',
      'YouTube searches use a shared project API key unless you configure your own key. The shared key is issued to this project and is not tied to your account. If you provide your own key, it is used for your YouTube API requests as described above.',
    ],
    list: [
      'YouTube Terms of Service — youtube.com/t/terms',
      'YouTube API Services Terms of Service — developers.google.com/youtube/terms/api-services-terms-of-service',
      'Google API Services User Data Policy — developers.google.com/terms/api-services-user-data-policy',
    ],
  },
  {
    heading: 'Children',
    body: [
      'needledrop is not directed at children under 13, and we do not knowingly collect personal information from them. The YouTube account you connect must be one you are allowed to use.',
    ],
  },
  {
    heading: 'Changes to this policy',
    body: [
      'If the handling of your data changes, this page changes first, and the date at the top changes with it.',
    ],
  },
]

export default function PrivacyPage() {
  return (
    <>
      <ScrollToTop />
      <main className="bg-paper text-ink">
        <section className="bg-ink text-paper">
          <div className="shell py-[6svh]">
            <p className="t-small uppercase tracking-widest text-paper/60">Legal</p>
            <h1 className="display t-mega mt-4 leading-[0.9]">Privacy</h1>
            <p className="t-lead mt-6 max-w-[60ch] text-paper/75">
              What needledrop reads from Google, why it needs it, what it stores, and how to make it
              disappear.
            </p>
            <p className="t-small mt-6 text-paper/50">Last updated 22 October 2026</p>
          </div>
        </section>

        <div className="shell py-[6svh]">
          <div className="max-w-[68ch]">
            {SECTIONS.map((section) => (
              <section key={section.heading} className="border-t-2 border-ink/15 py-8 first:border-t-0 first:pt-0">
                <h2 className="t-title font-semibold">{section.heading}</h2>
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="t-body mt-4 leading-relaxed text-ink/80">
                    {paragraph}
                  </p>
                ))}
                {section.list ? (
                  <ul className="mt-4 space-y-3">
                    {section.list.map((item) => (
                      <li key={item} className="t-body flex gap-3 leading-relaxed text-ink/80">
                        <span aria-hidden="true" className="mt-2 block h-2 w-2 shrink-0 bg-orange" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}

            <section className="border-t-2 border-ink/15 py-8">
              <h2 className="t-title font-semibold">Delete everything</h2>
              <p className="t-body mt-4 leading-relaxed text-ink/80">
                Sign out revokes your Google token when possible and clears your Google session
                cookie; it does not clear your saved YouTube API key.
                Delete all my data erases rows stored under your anonymous identifier — presets,
                blocks, feedback and run history — and rotates that identifier so the old cookie
                cannot reach anything. It does not delete playlists already saved to Google or
                Google, or clear your Google sign-in session or saved API key. Deletion cannot be
                undone.
              </p>
              <div className="mt-6">
                <DataControls />
              </div>
            </section>

            <section className="border-t-2 border-ink/15 py-8">
              <h2 className="t-title font-semibold">Contact</h2>
              <p className="t-body mt-4 leading-relaxed text-ink/80">
                Questions, deletions, or anything else:{' '}
                <a href="mailto:irgifebry2006@gmail.com" className="underline underline-offset-4">
                  irgifebry2006@gmail.com
                </a>
                . The source code is public, including this policy.
              </p>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
      {/* The delete and sign-out controls report their result through sonner,
          so the page has to mount the toaster itself. Without it the buttons
          look broken: the request succeeds and nothing appears. */}
      <Toaster />
    </>
  )
}
