export type SaveCtaState = 'loading' | 'sign-in' | 'create' | 'demo' | 'unavailable'
export type SaveCtaAction = 'sign-in' | 'create' | 'demo' | 'none'

export function getSaveCtaAction(state: SaveCtaState): SaveCtaAction {
  if (state === 'sign-in' || state === 'create' || state === 'demo') return state
  return 'none'
}

export function getSaveCta(state: {
  signedIn: boolean | null
  configured: boolean
  liveApi: boolean
  demo: boolean
}): SaveCtaState {
  if (state.signedIn === null) return 'loading'
  if (state.demo || !state.liveApi) return 'demo'
  if (!state.configured) return 'unavailable'
  return state.signedIn ? 'create' : 'sign-in'
}

export type GeneratorDraft = {
  title: string
  description: string
  privacy: 'private' | 'unlisted' | 'public'
  seed?: unknown
  candidates?: unknown[]
  picked?: string[]
  options?: unknown
}

const DRAFT_VERSION = 1

export function serializeGeneratorDraft(draft: GeneratorDraft): string {
  return JSON.stringify({ version: DRAFT_VERSION, draft })
}

export function storeGeneratorDraft(
  storage: Pick<Storage, 'setItem'>,
  draft: GeneratorDraft,
): boolean {
  try {
    storage.setItem('playlist-generator-draft', serializeGeneratorDraft(draft))
    return true
  } catch {
    return false
  }
}

export function parseGeneratorDraft(value: string): GeneratorDraft | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const snapshot = parsed as { version?: unknown; draft?: unknown }
    if (snapshot.version !== DRAFT_VERSION || !snapshot.draft || typeof snapshot.draft !== 'object') return null
    const draft = snapshot.draft as Partial<GeneratorDraft>
    if (
      typeof draft.title !== 'string' ||
      typeof draft.description !== 'string' ||
      !['private', 'unlisted', 'public'].includes(draft.privacy ?? '')
    ) return null
    return draft as GeneratorDraft
  } catch {
    return null
  }
}
