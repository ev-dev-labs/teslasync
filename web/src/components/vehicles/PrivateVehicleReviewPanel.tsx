import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { isApiError } from '@/api/client';
import { personalScope, usePersonalIdentity, type PersonalScope } from '@/api/hooks/usePersonalIdentity';
import { QueryError } from '../feedback/QueryError';
import { Skeleton } from '../feedback/Skeleton';
import { LayoutCard } from '../layout/layout-reference/LayoutCard';
import { Button } from '../ui/Button';
import { Text } from '../ui/Typography';
import { useDataState } from '@/hooks/useDataState';

export interface PrivateVehicleReviewScope {
  scope: Extract<PersonalScope, { mode: 'forward_auth' }>;
  vehicleId: number;
  identityPending: boolean;
}

interface Props {
  anchor: string;
  vehicleId: number | null;
  title: string;
  description: string;
  openLabel: string;
  vehiclePrompt: string;
  signInPrompt: string;
  children: (props: PrivateVehicleReviewScope) => ReactNode;
}

export function PrivateVehicleReviewPanel({ anchor, vehicleId, title, description, openLabel, vehiclePrompt, signInPrompt, children }: Props) {
  const { hash, key } = useLocation();
  const linked = hash === `#${anchor}`;
  const [expanded, setExpanded] = useState(linked);
  const region = useRef<HTMLElement>(null);
  const id = useId();
  const identity = usePersonalIdentity(expanded && vehicleId != null);
  const state = useDataState(identity);
  const scope = personalScope(state.data);
  const denied = isApiError(identity.error) && [401, 403].includes(identity.error.status);

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
              : scope?.mode !== 'forward_auth' ? <Text as="p" variant="bodySm">{signInPrompt}</Text>
              : children({ scope, vehicleId, identityPending: state.status !== 'ok' || identity.isFetching })}
          </div>}
        </div>
      </LayoutCard>
    </section>
  );
}
