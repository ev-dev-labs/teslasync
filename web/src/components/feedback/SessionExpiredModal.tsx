import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { SectionTitle, Text } from '../ui/Typography';
import { isRemoteMode } from '@/lib/serverConnection';
import { navigateToReauth } from '@/lib/resilience';

export function SessionExpiredModal() {
  const { t } = useTranslation();
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const handler = () => {
      if (isRemoteMode()) setExpired(true);
    };
    document.addEventListener('teslasync:session-expired', handler);
    return () => document.removeEventListener('teslasync:session-expired', handler);
  }, []);
  if (!isRemoteMode()) return null;
  return (
    <Modal open={expired} onClose={() => { /* Native access requires reconnecting with a valid key. */ }} size="sm"
      ariaLabel={t('session.appTokenExpired.title', 'App connection expired')}
      data-testid="session-expired-modal">
      <SectionTitle>{t('session.appTokenExpired.title', 'App connection expired')}</SectionTitle>
      <Text>{t('session.appTokenExpired.body', 'The server rejected your app access token. Reconnect with a valid key.')}</Text>
      <Button onClick={navigateToReauth} data-testid="session-expired-signin">
        {t('session.appTokenExpired.reconnect', 'Reconnect')}
      </Button>
    </Modal>
  );
}
