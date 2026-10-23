'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

/**
 * The "delete all my data" control.
 *
 * Two distinct things are being undone here, and they are not the same
 * action:
 *
 * - Signing out revokes the refresh token on Google's side and clears the
 *   session cookie. The token stops working everywhere.
 * - Deleting erases the rows stored under the anonymous id — presets,
 *   blocks, feedback, run history — and rotates that id so the old cookie
 *   cannot reach anything.
 *
 * Both are irreversible, so the destructive one is behind an explicit
 * confirmation rather than a single click.
 */
type DataControlsProps = { signedIn: boolean }

export function DataControls({ signedIn }: DataControlsProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)

  async function deleteEverything() {
    const confirmed = window.confirm(
      'This erases every preset, blocked track, feedback entry and run history stored for this browser, and cannot be undone.\n\nContinue?',
    )
    if (!confirmed) return

    setBusy(true)
    try {
      const response = await fetch('/api/feedback', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })

      if (!response.ok) {
        toast.error('Nothing was deleted.', {
          description: 'The server refused the request. Try again, or email us and we will do it.',
        })
        return
      }

      const result = (await response.json()) as {
        deleted?: Record<string, number>
        store?: 'memory' | 'postgres'
      }
      if (!result.deleted || !result.store) throw new Error('Deletion response was incomplete')
      const counts = Object.entries(result.deleted)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${count} ${kind}`)
      const store = result.store === 'postgres' ? 'Postgres' : 'in-memory store'
      const deletedDescription = counts.length ? `Deleted ${counts.join(', ')} from the ${store}.` : `No matching rows were found in the ${store}.`
      toast.success('Anonymous data deletion completed.', {
        description: `${deletedDescription} Google playlists, sign-in, and your saved API key were not changed.${result.store === 'memory' ? ' Data in an unavailable Postgres database was not deleted.' : ''}`,
      })
    } catch {
      toast.error('Nothing was deleted.', {
        description: 'The request never reached the server. Check your connection and try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      // The logout route redirects; a fetch follows that redirect silently, so
      // the navigation is done here.
      if (!response.redirected && !response.ok) throw new Error('Logout request failed')
      router.replace('/')
      router.refresh()
    } catch {
      toast.error('Sign out failed.', { description: 'Check your connection and try again.' })
      setBusy(false)
      setLogoutBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      {signedIn ? (
        <Button type="button" variant="outline" onClick={() => { setBusy(true); setLogoutBusy(true); void signOut() }} disabled={busy}>
          {logoutBusy ? 'Signing out…' : 'Sign out and revoke access'}
        </Button>
      ) : null}
      <Button type="button" variant="ink" onClick={deleteEverything} disabled={busy}>
        Delete my anonymous data
      </Button>
    </div>
  )
}
