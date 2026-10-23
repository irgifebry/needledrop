import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const library = readFileSync(new URL('../../components/library/library-view.tsx', import.meta.url), 'utf8')
const editor = readFileSync(new URL('../../components/library/playlist-editor.tsx', import.meta.url), 'utf8')

describe('Library recovery and mutation safety', () => {
  it('allows retrying a failed library load and distinguishes auth from permission recovery', () => {
    expect(library).toContain('Retry')
    expect(library).toContain('loadLibrary')
    expect(library).toContain('status === 401')
    expect(library).toContain('status === 403')
  })

  it('provides an explicit back-to-library link from the editor', () => {
    expect(editor).toContain('Back to library')
    expect(editor).toContain('href="/library"')
  })

  it('announces editor progress and outcomes accessibly', () => {
    expect(editor).toContain('aria-live="polite"')
    expect(editor).toContain('role="status"')
  })

  it('prevents duplicate metadata, item, and delete mutations while a request is pending', () => {
    expect(editor).toContain('if (mutationLock.current) return')
    expect(editor).toContain('disabled={!dirty || saving || mutating}')
  })

  it('offers retry and separate sign-in/permission guidance for editor load failures', () => {
    expect(editor).toContain('Retry')
    expect(editor).toContain('status === 401')
    expect(editor).toContain('status === 403')
  })
})
