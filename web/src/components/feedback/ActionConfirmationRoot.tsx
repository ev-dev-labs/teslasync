import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionCanceledError, registerActionConfirmationProvider } from '@/api/actionConfirmation';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Code } from '../ui/Typography';
import { subscribe } from '@/lib/broadcast';

interface PendingAction {
  id: number;
  path: string;
  finish: (accepted: boolean) => void;
}

export function ActionConfirmationRoot() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingAction[]>([]);
  const queue = useRef<PendingAction[]>([]);
  const nextID = useRef(0);

  useEffect(() => {
    const unsubscribe = subscribe(message => {
      if (message.type === 'auth.logout') {
        for (const action of [...queue.current]) action.finish(false);
      }
    });
    const unregister = registerActionConfirmationProvider((path, signal) => new Promise<void>((resolve, reject) => {
      const id = ++nextID.current;
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
      queue.current = [...queue.current, { id, path, finish }];
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
  if (!active) return null;
  return (
    <ConfirmDialog
      key={active.id}
      open
      title={t('actionConfirmation.title', 'Confirm sensitive action')}
      message={t('actionConfirmation.body', 'This action can change or remove data. Your authentication provider handles sign-in; TeslaSync only asks you to confirm your intent.')}
      details={<Code>{active.path}</Code>}
      requireTypedConfirmation="CONFIRM"
      typedConfirmationLabel={t('actionConfirmation.type', 'Type CONFIRM to continue')}
      confirmLabel={t('common.confirm', 'Confirm')}
      cancelLabel={t('common.cancel', 'Cancel')}
      onConfirm={() => active.finish(true)}
      onCancel={() => active.finish(false)}
    />
  );
}
