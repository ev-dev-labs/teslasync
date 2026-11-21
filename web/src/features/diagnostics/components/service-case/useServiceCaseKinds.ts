import { useTranslation } from 'react-i18next';
import type { ServiceCaseKind } from '@/types/serviceCase';

export function useServiceCaseKinds(): Record<ServiceCaseKind, string> {
  const { t } = useTranslation();
  return {
    warning: t('serviceEvidencePack.privateCase.kinds.warning', 'Warning'),
    condition: t('serviceEvidencePack.privateCase.kinds.condition', 'Observed condition'),
    firmware: t('serviceEvidencePack.privateCase.kinds.firmware', 'Firmware'),
    recorded_work: t('serviceEvidencePack.privateCase.kinds.work', 'Recorded work'),
  };
}
