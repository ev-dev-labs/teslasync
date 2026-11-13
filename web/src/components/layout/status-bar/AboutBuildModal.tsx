import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button } from '@/components/ui/runtime';
import { Text } from '@/components/ui/Typography';
import { captureAppDesignOrigin } from '@/components/ui/appDesignOrigin';
import { AlertBanner } from '@/components/feedback/AlertBanner';
import { reportFrontendError } from '@/lib/errorReporter';
import type { AboutBuildModalContent } from './AboutBuildModalContent';

interface AboutBuildModalProps {
  open: boolean;
  onClose: () => void;
}

function OpenAboutBuildModal({ onClose }: Pick<AboutBuildModalProps, 'onClose'>) {
  const { t } = useTranslation();
  const [originSnapshot] = useState(() => {
    const origin = typeof document === 'undefined' ? null : document.activeElement;
    return captureAppDesignOrigin(origin && origin instanceof HTMLElement &&
      origin !== document.body && origin !== document.documentElement ? origin : null);
  });
  const [Content, setContent] = useState<typeof AboutBuildModalContent | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    void import('./AboutBuildModalContent').then(module => {
      if (!cancelled) setContent(() => module.AboutBuildModalContent);
    }, error => {
      if (cancelled) return;
      reportFrontendError(error, 'react');
      setLoadFailed(true);
    });
    return () => { cancelled = true; };
  }, [attempt]);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('statusBar.version.modalTitle', 'About this build')}
      originSnapshot={originSnapshot}
      getReturnFocusTarget={() => originSnapshot.origin}
    >
      {Content ? <Content onClose={onClose} /> : loadFailed ? (
        <AlertBanner variant="danger" role="alert">
          {t('errorBoundary.inlineTitle', 'Component failed to load')}
          <Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>
            {t('error.retry', 'Retry')}
          </Button>
        </AlertBanner>
      ) : <Text role="status">{t('a11y.loading', 'Loading')}</Text>}
    </Modal>
  );
}

export function AboutBuildModal({ open, onClose }: AboutBuildModalProps) {
  return open ? <OpenAboutBuildModal onClose={onClose} /> : null;
}
