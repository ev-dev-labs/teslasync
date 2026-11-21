import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { isApiError } from '@/api/client';
import { personalScope, usePersonalIdentity, type PersonalScope } from '@/api/hooks/usePersonalIdentity';
import { QueryError } from '../feedback/QueryError';
import { Skeleton } from '../feedback/Skeleton';
import { LayoutCard } from '../layout/layout-reference/LayoutCard';
import { Button } from '../ui/Button';
import { Text } from '../ui/Typography';
import { useDataState } from '@/hooks/useDataState';

interface VehicleReviewScope {
  scope: PersonalScope;
  vehicleId: number;
  identityPending: boolean;
}

export interface PrivateVehicleReviewScope extends VehicleReviewScope {
  scope: Extract<PersonalScope, { mode: 'forward_auth' }>;
}

interface Props {
  anchor: string;
  vehicleId: number | null;
  title: string;
  description: string;
  openLabel: string;
  vehiclePrompt: string;
}

type ScopePolicy =
  | { allowSharedOpen: true; children: (props: VehicleReviewScope) => ReactNode }
  | { allowSharedOpen?: false; signInPrompt: string; children: (props: PrivateVehicleReviewScope) => ReactNode };

export function PrivateVehicleReviewPanel(props: Props & ScopePolicy) {
  const { anchor, vehicleId, title, description, openLabel, vehiclePrompt } = props;
  const { t } = useTranslation();
  const { hash, key } = useLocation();
  const linked = hash === `#${anchor}`;
  const [expanded, setExpanded] = useState(linked);
  const region = useRef<HTMLElement>(null);
  const id = useId();
  const identity = usePersonalIdentity(expanded && vehicleId != null);
  const state = useDataState(identity);
  const scope = personalScope(state.data);
  const denied = isApiError(identity.error) && [401, 403].includes(identity.error.status);
  const identityPending = state.status !== 'ok' || identity.isFetching;

  function renderReview(id: number) {
    if (props.allowSharedOpen) {
      if (!scope) return <Text as="p" variant="bodySm">
        {t('personalScope.unavailable', 'This installation’s access mode could not be verified. Refresh and try again.')}
      </Text>;
      return <>
        {scope.mode === 'open' && <Text as="p" variant="bodySm">
          {t('personalScope.sharedReview', 'Without sign-in, anyone with access to TeslaSync can view and manage this review.')}
        </Text>}
        {props.children({ scope, vehicleId: id, identityPending })}
      </>;
    }
    return scope?.mode === 'forward_auth'
      ? props.children({ scope, vehicleId: id, identityPending })
      : <Text as="p" variant="bodySm">{props.signInPrompt}</Text>;
  }

  useEffect(() => {
    if (linked) {
      setExpanded(true);
      region.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [linked, key]);

  return (
    <section id={anchor} ref={region} aria-label={title} className="scroll-mt-4">
      <LayoutCard title={title}>
        <div className="space-y-3">
          <Text as="p" variant="bodySm">{description}</Text>
          <Button type="button" className="min-h-11" variant="secondary" wrapLabel aria-expanded={expanded}
            aria-controls={id} onClick={() => setExpanded(!expanded)}>{openLabel}</Button>
          {expanded && <div id={id}>
            {vehicleId == null ? <Text as="p" variant="bodySm">{vehiclePrompt}</Text>
              : denied || state.fatalError ? <QueryError error={state.fatalError ?? identity.error} onRetry={state.retry ?? undefined} />
              : !state.hasData ? <Skeleton lines={2} />
              : renderReview(vehicleId)}
          </div>}
        </div>
      </LayoutCard>
    </section>
  );
}
