/**
 * Secret Rotation page — admin observability surface.
 *
 * Per-(kind, target) rotation tracker. Surfaces the age of every tracked
 * secret (Tesla refresh token, MQTT mTLS cert, DB password, session JWK,
 * Authentik client secret, app signing key) with a severity tier computed
 * against per-kind warn/critical thresholds on the server.
 *
 * Modern-UI full-width bento: an OperationalBrief, an age-by-secret chart + severity
 * donut, a rotation-urgency / expiry-watch row, and a full-width detail
 * table. Every data section owns its loading / empty / error state.
 *
 * Backed by GET /api/v1/admin/observability/secret-rotation
 * (internal/handler/v1/admin_observability_handler.go).
 */
import { PageLayout } from '@/components/layout';
import { AlertBanner, DataStateNotice } from '@/components/feedback';
import { useSecretRotationPage } from '../hooks/useSecretRotationPage';
import { SecretRotationOperationalBrief } from '../components/statstrip-coverage-flags-secrets/SecretRotationOperationalBrief';
import { SecretRotationCharts } from '../components/structural-closure/secret-rotation/SecretRotationCharts';
import { SecretRotationOutlook } from '../components/structural-closure/secret-rotation/SecretRotationOutlook';
import { SecretRotationDetails } from '../components/structural-closure/secret-rotation/SecretRotationDetails';

export default function SecretRotationPage() {
  const controller = useSecretRotationPage();
  const { t, query, subsystemMissing, counts } = controller;
  return (
    <PageLayout
      title={t('admin.secretRotation.pageTitle', 'Secret rotation')}
      subtitle={t(
        'admin.secretRotation.subtitle',
        'Status of every tracked credential. Severity reflects per-kind warn/critical thresholds; rotate anything in the critical tier as soon as possible.',
      )}
      query={query}
      dataSources={[{ id: 'secret-rotation', label: t('admin.secretRotation.pageTitle', 'Secret rotation'), query }]}
    >
      {subsystemMissing && (
        <DataStateNotice state="unsupported" title={t('admin.subsystem.unsupportedTitle', 'Feature not supported')}>
          {t(
            'admin.secretRotation.notConfigured',
            'The rotation tracker is not configured on this deployment. Enable secret rotation tracking in config to populate this page.',
          )}
        </DataStateNotice>
      )}

      {counts.critical > 0 && (
        <AlertBanner variant="danger" title={t('admin.secretRotation.criticalTitle', 'Overdue rotations')}>
          {t(
            'admin.secretRotation.criticalMessage',
            '{{count}} secrets are past their critical rotation threshold. These should be rotated immediately to reduce blast radius.',
            { count: counts.critical },
          )}
        </AlertBanner>
      )}

      <SecretRotationOperationalBrief controller={controller} />
      <SecretRotationCharts controller={controller} />
      <SecretRotationOutlook controller={controller} />
      <SecretRotationDetails controller={controller} />
    </PageLayout>
  );
}
