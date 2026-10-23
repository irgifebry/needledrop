import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn(),
  fetch: vi.fn(),
  buttonProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }))
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => {
    mocks.buttonProps.push(props)
    return createElement('button', props, children)
  },
}))

import { DataControls } from '@/components/privacy/data-controls'

function controls(signedIn: boolean) {
  mocks.buttonProps.length = 0
  renderToStaticMarkup(createElement(DataControls, { signedIn }))
  return mocks.buttonProps
}

describe('privacy data controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.buttonProps.length = 0
    vi.stubGlobal('fetch', mocks.fetch)
    vi.stubGlobal('window', { confirm: mocks.confirm })
    mocks.confirm.mockReturnValue(true)
  })

  it('keeps deletion available while signed out and hides sign out', () => {
    const buttons = controls(false)
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toMatchObject({ type: 'button', variant: 'ink' })
    expect(renderToStaticMarkup(createElement(DataControls, { signedIn: false }))).toContain('Delete my anonymous data')
  })

  it('does not issue a deletion request when the user cancels', async () => {
    mocks.confirm.mockReturnValue(false)
    const buttons = controls(false)
    await (buttons[0].onClick as () => Promise<void>)()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('reports the actual deleted counts and store returned by the API', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ deleted: { presets: 2, blocks: 1 }, store: 'postgres' }),
    })
    const buttons = controls(false)
    await (buttons[0].onClick as () => Promise<void>)()
    expect(mocks.success).toHaveBeenCalledWith('Anonymous data deletion completed.', {
      description: 'Deleted 2 presets, 1 blocks from the Postgres. Google playlists, sign-in, and your saved API key were not changed.',
    })
  })

  it('does not imply memory deletion removed rows from unavailable Postgres', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ deleted: { runs: 3 }, store: 'memory' }),
    })
    const buttons = controls(false)
    await (buttons[0].onClick as () => Promise<void>)()
    expect(mocks.success).toHaveBeenCalledWith('Anonymous data deletion completed.', {
      description: expect.stringContaining('Data in an unavailable Postgres database was not deleted.'),
    })
  })

  it('waits for logout before navigating, then preserves the home redirect', async () => {
    let finish!: (value: unknown) => void
    mocks.fetch.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const buttons = controls(true)
    const pending = (buttons[0].onClick as () => Promise<void>)()
    expect(mocks.replace).not.toHaveBeenCalled()
    finish({ ok: true, redirected: true, status: 200 })
    await pending
    expect(mocks.replace).toHaveBeenCalledWith('/')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('does not navigate when logout returns a genuine non-OK response', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, redirected: false, status: 500 })
    const buttons = controls(true)
    await (buttons[0].onClick as () => Promise<void>)()
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith('Sign out failed.', expect.any(Object))
  })

  it('handles logout pending and request errors without changing the redirect contract', async () => {
    mocks.fetch.mockRejectedValue(new Error('offline'))
    const buttons = controls(true)
    expect(buttons).toHaveLength(2)
    await (buttons[0].onClick as () => Promise<void>)()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith('Sign out failed.', expect.any(Object))
  })
})
