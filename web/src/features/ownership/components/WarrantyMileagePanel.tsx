import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { useWarranties } from '@/api/hooks/useOwnership';
import { personalScope, type usePersonalIdentity } from '@/api/hooks/usePersonalIdentity';
import { QueryError, Skeleton } from '@/components/feedback';
import { Select, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useUrlString } from '@/hooks/useUrlState';
import { OwnershipPanel } from './OwnershipPanel';
import { WarrantyMileageControl } from './WarrantyMileageControl';

interface Props {
  identity: ReturnType<typeof usePersonalIdentity>;
  register: ReturnType<typeof useWarranties>;
  vehicleId: number | null;
}

export function WarrantyMileagePanel({ identity, register, vehicleId }: Props) {
  const { t } = useTranslation();
  const { hash, key } = useLocation();
  const section = useRef<HTMLElement>(null);
  const [requested, setRequested] = useUrlString('warranty_id');
  const identityState = useDataState(identity);
  const registerState = useDataState(register);
  const scope = personalScope(identityState.data);
  const warranties = (registerState.data?.items ?? []).filter((row) => row.vehicle_id === vehicleId);
  const selected = requested ? warranties.find((row) => String(row.id) === requested) : warranties[0];
  const title = t('ownership.warranty.mileage.title', 'Private warranty mileage reminder');

  useEffect(() => {
    if (hash === '#warranty-mileage') section.current?.scrollIntoView?.({ block: 'start' });
  }, [hash, key]);

  return (
    <section ref={section} id="warranty-mileage" aria-label={title} className="scroll-mt-4">
      <OwnershipPanel title={title}>
        {identityState.fatalError ? <QueryError error={identityState.fatalError} onRetry={() => void identity.refetch()} />
          : !identityState.hasData ? <Skeleton lines={2} />
          : scope?.mode !== 'forward_auth' ? <Text as="p" variant="bodySm">
            {t('ownership.warranty.mileage.signIn', 'This reminder requires a verified sign-in; it is not available in a shared installation without sign-in.')}
          </Text> : vehicleId == null ? <Text as="p" variant="bodySm">
            {t('ownership.warranty.mileage.vehicle', 'Select a vehicle in the workspace picker to review a warranty reminder.')}
          </Text> : registerState.fatalError ? <QueryError error={registerState.fatalError} onRetry={() => void register.refetch()} />
          : !registerState.hasData ? <Skeleton lines={2} />
          : warranties.length === 0 ? <Text as="p" variant="bodySm">
            {t('ownership.warranty.mileage.noWarranty', 'Record the documented warranty terms for this vehicle to opt in.')}
          </Text> : <>
            <Select label={t('ownership.warranty.mileage.warranty', 'Warranty to check')}
              value={selected ? String(selected.id) : ''}
              placeholder={t('ownership.warranty.mileage.unavailable', 'Requested warranty is unavailable for this vehicle')}
              options={warranties.map((row) => ({ value: String(row.id), label: row.label }))}
              onChange={(event) => setRequested(event.target.value)} />
            {selected && <WarrantyMileageControl key={`${scope.subject}:${vehicleId}:${selected.id}`}
              scope={scope} vehicleId={vehicleId} warrantyId={selected.id}
              disabled={identity.isFetching || identityState.status !== 'ok' || register.isFetching || registerState.status !== 'ok'} />}
          </>}
      </OwnershipPanel>
    </section>
  );
}
