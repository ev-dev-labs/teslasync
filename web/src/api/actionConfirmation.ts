export class ActionCanceledError extends Error {
  constructor(message = 'Action cancelled by user') {
    super(message);
    this.name = 'ActionCanceledError';
  }
}

export type ActionConfirmationProvider = (path: string, signal?: AbortSignal | null) => Promise<void>;

let provider: ActionConfirmationProvider | null = null;

export function registerActionConfirmationProvider(next: ActionConfirmationProvider): () => void {
  provider = next;
  return () => {
    if (provider === next) provider = null;
  };
}

export function __resetActionConfirmationForTests(): void {
  provider = null;
}

export function requiresActionConfirmation(method: string | undefined, path: string): boolean {
  const verb = (method ?? 'GET').toUpperCase();
  const pathname = path.split('?')[0].replace(/\/$/, '');
  if (verb === 'DELETE') {
    return /^\/(?:vehicles\/[^/]+|api-keys\/[^/]+|system\/flags\/[^/]+|backup\/configs\/[^/]+)$/.test(pathname)
      || pathname.startsWith('/data-repair/');
  }
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return false;
  return /^\/(?:auth\/disconnect|settings\/(?:import|reset)|export\/jobs\/import|api-keys\/[^/]+\/revoke|system\/(?:flags\/[^/]+|dlq\/[^/]+\/replay)|admin\/(?:impersonate|service-intelligence\/communications\/import))$/.test(pathname)
    || /^\/vehicles\/[^/]+\/guard(?:\/(?:config|panic))?$/.test(pathname)
    || (pathname.startsWith('/data-repair/')
      && !pathname.endsWith('/preview') && !pathname.endsWith('/correction-preview'));
}

export async function confirmAction(path: string, signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  if (!provider) throw new ActionCanceledError('No action confirmation dialog is mounted');
  const current = provider;
  if (!signal) {
    await current(path, signal);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve().then(() => {
      signal.throwIfAborted();
      return current(path, signal);
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
  signal?.throwIfAborted();
}
