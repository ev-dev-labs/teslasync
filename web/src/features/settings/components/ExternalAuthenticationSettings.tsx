import { useTranslation } from 'react-i18next';
import { useAuthMode } from '@/api/hooks/useAuthMode';
import { deriveDataState } from '@/api/dataState';
import { PageLayout } from '@/components/layout';
import { GlassPanel, SectionTitle, Text, Button } from '@/components/ui';
import { QueryError, DataStateNotice } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { navigateToReauth } from '@/lib/resilience';
import { isRemoteMode } from '@/lib/serverConnection';

export function ExternalAuthenticationSettings() {
  const { t } = useTranslation();
  const query = useAuthMode();
  const state = deriveDataState(query);
  const external = query.data?.mode === 'forward_auth';
  const native = isRemoteMode();
  const title = t('externalAuth.title', 'Authentication and access');
  usePageTitle(title);
  return (
    <PageLayout title={title} subtitle={t('externalAuth.subtitle', 'Your authentication service owns browser sign-in, MFA and sessions.')} query={query}>
      {state.status === 'stale' && <DataStateNotice state="stale" preserveSeverity />}
      {state.fatalError && <QueryError error={state.fatalError} onRetry={() => void query.refetch()} />}
      <GlassPanel className="space-y-3 p-5 sm:p-6">
        <SectionTitle>{t('externalAuth.identityTitle', 'Connection identity')}</SectionTitle>
        <Text as="p">{native
          ? t('externalAuth.native', 'This app uses a server access key. Browser authentication and provider sessions do not control that key.')
          : external
            ? query.data?.provider_hint ?? t('externalAuth.provider', 'External authentication provider')
            : query.data?.mode === 'open'
              ? t('externalAuth.open', 'Open mode: no browser authentication is configured. Restrict network access before exposing this installation.')
              : t('externalAuth.unknown', 'The server authentication policy is not available yet.')}</Text>
        <Text as="p" color="secondary" className="break-words [overflow-wrap:anywhere]">{query.data?.subject
          ?? t('externalAuth.noIdentity', 'No verified user identity was supplied for this request.')}</Text>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => void query.refetch()} disabled={query.isFetching}>
            {t('externalAuth.refresh', 'Refresh identity')}
          </Button>
        </div>
      </GlassPanel>
      <GlassPanel className="space-y-3 p-5 sm:p-6">
        <SectionTitle>{t('externalAuth.securityTitle', 'Sign-in, MFA and device sessions')}</SectionTitle>
        <Text as="p">{t('externalAuth.securityBody', 'Manage your password, second factors, recovery codes and signed-in devices in your authentication service. TeslaSync does not create passwords, enroll MFA, issue browser sessions or revoke provider sessions.')}</Text>
        <Text as="p" color="secondary">{t('externalAuth.securityHelp', 'Open your authentication service directly to manage these settings. Its normal session policy applies; sensitive TeslaSync actions ask for confirmation, not another password.')}</Text>
        {external && !native && <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={navigateToReauth}>
            {t('externalAuth.checkSignIn', 'Check provider sign-in')}
          </Button>
        </div>}
      </GlassPanel>
      <GlassPanel className="space-y-3 p-5 sm:p-6">
        <SectionTitle>{t('externalAuth.accessTitle', 'Access policy')}</SectionTitle>
        <Text as="p">{t('externalAuth.accessBody', 'Everyone admitted by your browser authentication provider is a trusted operator with full application access. Limit who can enter at your proxy or authentication service; there is no separate TeslaSync role matrix.')}</Text>
        <Text as="p" color="secondary">{t('externalAuth.connections', 'Personal preferences remain separate by verified identity. Native and automation access keys keep their own scopes. Tesla account authorization, share tokens, webhook credentials and operation safeguards remain independent.')}</Text>
      </GlassPanel>
    </PageLayout>
  );
}
