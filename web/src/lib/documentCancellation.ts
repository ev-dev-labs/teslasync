interface DocumentScope {
  unloading: boolean
  dispose: () => void
}

const scopes = new WeakMap<Window, DocumentScope>()

function documentScope(owner: Window): DocumentScope {
  const existing = scopes.get(owner)
  if (existing) return existing
  let resumeTimer: ReturnType<typeof setTimeout> | undefined
  const scope: DocumentScope = { unloading: false, dispose: () => undefined }
  const cancel = (event: Event) => {
    if (event.isTrusted) scope.unloading = true
  }
  const resume = () => {
    if (resumeTimer !== undefined) clearTimeout(resumeTimer)
    resumeTimer = undefined
    scope.unloading = false
  }
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!event.isTrusted) return
    cancel(event)
    if (resumeTimer !== undefined) clearTimeout(resumeTimer)
    // Observe the completed event after dirty-form handlers and the prompt.
    // Cancelling navigation must not disable reads in the surviving document.
    resumeTimer = setTimeout(() => {
      resumeTimer = undefined
      if (event.defaultPrevented) resume()
    }, 0)
  }
  owner.addEventListener('beforeunload', beforeUnload)
  owner.addEventListener('pagehide', cancel)
  const pageShow = (event: PageTransitionEvent) => {
    if (event.isTrusted) resume()
  }
  owner.addEventListener('pageshow', pageShow)
  scope.dispose = () => {
    if (resumeTimer !== undefined) clearTimeout(resumeTimer)
    owner.removeEventListener('beforeunload', beforeUnload)
    owner.removeEventListener('pagehide', cancel)
    owner.removeEventListener('pageshow', pageShow)
  }
  scopes.set(owner, scope)
  return scope
}

/**
 * Teardown callbacks can start fresh API reads after beforeunload, when
 * document network observers are already detaching. Reject those late starts
 * before fetch rather than replacing caller signals or changing request timing.
 * Only browser-generated lifecycle events end the lifetime: synthetic events
 * used to flush telemetry do not mean the document actually navigated away.
 */
export function assertDocumentActive(): void {
  if (typeof window !== 'undefined' && documentScope(window).unloading) {
    throw new DOMException('Document is unloading', 'AbortError')
  }
}

export function __resetDocumentCancellationForTests(): void {
  if (typeof window === 'undefined') return
  scopes.get(window)?.dispose()
  scopes.delete(window)
}
