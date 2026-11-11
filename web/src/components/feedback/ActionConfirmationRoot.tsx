import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionCanceledError, registerActionConfirmationProvider } from '@/api/actionConfirmation';
import type { ActionConfirmationDialog } from './ActionConfirmationDialog';
import { captureAppDesignOrigin, type AppDesignOriginSnapshot } from '../ui/appDesignOrigin';
import { Button } from '../ui/Button';
import { AlertBanner } from './AlertBanner';
import { isFocusRestorable } from '@/hooks/useDialogFocus';
import { subscribe } from '@/lib/broadcast';
import { reportFrontendError } from '@/lib/errorReporter';

interface PendingAction {
  id: number;
  path: string;
  finish: (accepted: boolean) => void;
  originSnapshot: AppDesignOriginSnapshot;
}

export function ActionConfirmationRoot() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingAction[]>([]);
  const queue = useRef<PendingAction[]>([]);
  const nextID = useRef(0);
  const [Dialog, setDialog] = useState<typeof ActionConfirmationDialog | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loadingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = subscribe(message => {
      if (message.type === 'auth.logout') {
        for (const action of [...queue.current]) action.finish(false);
      }
    });
    const unregister = registerActionConfirmationProvider((path, signal) => new Promise<void>((resolve, reject) => {
      const id = ++nextID.current;
      const origin = document.activeElement;
      const originSnapshot = captureAppDesignOrigin(origin instanceof HTMLElement &&
        origin !== document.body && origin !== document.documentElement ? origin : null);
      let settled = false;
      const finish = (accepted: boolean) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        queue.current = queue.current.filter(item => item.id !== id);
        setPending(queue.current);
        if (signal?.aborted) reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        else if (accepted) resolve();
        else reject(new ActionCanceledError());
      };
      const abort = () => finish(false);
      queue.current = [...queue.current, { id, path, finish, originSnapshot }];
      setPending(queue.current);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    }));
    return () => {
      unregister();
      unsubscribe();
      for (const action of [...queue.current]) action.finish(false);
    };
  }, []);

  const active = pending[0];
  const cancelActive = useCallback(() => {
    const origin = active?.originSnapshot.origin;
    if (loadingRef.current?.contains(document.activeElement) && isFocusRestorable(origin)) origin.focus();
    active?.finish(false);
  }, [active]);

  useEffect(() => {
    if (!active || Dialog) return;
    let cancelled = false;
    setLoadFailed(false);
    void import('./ActionConfirmationDialog').then(module => {
      if (!cancelled) setDialog(() => module.ActionConfirmationDialog);
    }, error => {
      if (cancelled) return;
      reportFrontendError(error, 'react');
      setLoadFailed(true);
    });
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancelActive();
    };
    window.addEventListener('keydown', cancel);
    return () => { cancelled = true; window.removeEventListener('keydown', cancel); };
  }, [active, Dialog, loadAttempt, cancelActive]);

  if (!active) return null;
  if (!Dialog) return (
    <div ref={loadingRef}>
      <AlertBanner variant={loadFailed ? 'danger' : 'info'} role={loadFailed ? 'alert' : 'status'}
        aria-label={t('actionConfirmation.title', 'Confirm sensitive action')}>
        {loadFailed ? t('errorBoundary.inlineTitle', 'Component failed to load') : t('a11y.loading', 'Loading')}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={cancelActive}>{t('common.cancel', 'Cancel')}</Button>
          {loadFailed && <Button variant="secondary" onClick={() => setLoadAttempt(attempt => attempt + 1)}>
            {t('error.retry', 'Retry')}
          </Button>}
        </div>
      </AlertBanner>
    </div>
  );
  return (
    <Dialog
      key={active.id}
      path={active.path}
      originSnapshot={active.originSnapshot}
      onConfirm={() => active.finish(true)}
      onCancel={cancelActive}
    />
  );
}
