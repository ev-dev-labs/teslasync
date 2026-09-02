import { useQuery } from '@tanstack/react-query';

import { request } from '../client';
import { queryPolicy } from '../queryPolicy';
import { scopeKey, scopedPath, type QueryScope } from '../scope';
import type {
  ChargePhysics,
  FsdHeartbeat,
  GearTheater,
  OutageAutobiography,
  PhysicsCockpit,
  ParkTruth,
  SessionCertificate,
  SilentReport,
  VampireSplit,
} from '@/types/teslaPhysics';

export const physicsKeys = {
  charge: (sessionId: string) => ['physics', 'charge', sessionId] as const,
  theater: (driveId: string) => ['physics', 'theater', driveId] as const,
  silent: (driveId: string) => ['physics', 'silent', driveId] as const,
  cockpit: (scope: QueryScope) => ['physics', 'cockpit', ...scopeKey(scope)] as const,
  heartbeat: (scope: QueryScope) => ['physics', 'heartbeat', ...scopeKey(scope)] as const,
  park: (scope: QueryScope) => ['physics', 'park', ...scopeKey(scope)] as const,
  vampire: (scope: QueryScope) => ['physics', 'vampire', ...scopeKey(scope)] as const,
  outage: (scope: QueryScope) => ['physics', 'outage', ...scopeKey(scope)] as const,
  certificate: (scope: QueryScope) => ['physics', 'certificate', ...scopeKey(scope)] as const,
};

export function useChargePhysics(sessionId: string | undefined) {
  return useQuery({
    queryKey: physicsKeys.charge(sessionId ?? ''),
    queryFn: ({ signal }) => request<ChargePhysics>(`/physics/charging/${sessionId}`, { signal }),
    enabled: !!sessionId,
    ...queryPolicy('operational'),
  });
}

export function useGearTheater(driveId: string | undefined) {
  return useQuery({
    queryKey: physicsKeys.theater(driveId ?? ''),
    queryFn: ({ signal }) => request<GearTheater>(`/physics/drives/${driveId}/theater`, { signal }),
    enabled: !!driveId,
    ...queryPolicy('historical'),
  });
}

export function useSilentCounter(driveId: string | undefined) {
  return useQuery({
    queryKey: physicsKeys.silent(driveId ?? ''),
    queryFn: ({ signal }) => request<SilentReport>(`/physics/drives/${driveId}/silent`, { signal }),
    enabled: !!driveId,
    ...queryPolicy('historical'),
  });
}

export function usePhysicsCockpit(vehicleId: string | undefined) {
  const scope: QueryScope = { vehicleId: vehicleId ?? null };
  return useQuery({
    queryKey: physicsKeys.cockpit(scope),
    queryFn: ({ signal }) => request<PhysicsCockpit>(scopedPath('/physics/cockpit', scope), { signal }),
    enabled: !!vehicleId,
    ...queryPolicy('live'),
  });
}

export function useFsdHeartbeat(vehicleId: string | undefined) {
  const scope: QueryScope = { vehicleId: vehicleId ?? null };
  return useQuery({
    queryKey: physicsKeys.heartbeat(scope),
    queryFn: ({ signal }) => request<FsdHeartbeat>(scopedPath('/physics/heartbeat', scope), { signal }),
    enabled: !!vehicleId,
    ...queryPolicy('live'),
  });
}

export function useParkTruth(vehicleId: string | undefined) {
  const scope: QueryScope = { vehicleId: vehicleId ?? null };
  return useQuery({
    queryKey: physicsKeys.park(scope),
    queryFn: ({ signal }) => request<ParkTruth>(scopedPath('/physics/park-truth', scope), { signal }),
    enabled: !!vehicleId,
    ...queryPolicy('live'),
  });
}

export function useVampireSplit(vehicleId: string | undefined) {
  const scope: QueryScope = { vehicleId: vehicleId ?? null };
  return useQuery({
    queryKey: physicsKeys.vampire(scope),
    queryFn: ({ signal }) => request<VampireSplit>(scopedPath('/physics/vampire', scope), { signal }),
    enabled: !!vehicleId,
    ...queryPolicy('historical'),
  });
}

export function useOutageAutobiography(vehicleId: string | undefined) {
  const scope: QueryScope = { vehicleId: vehicleId ?? null };
  return useQuery({
    queryKey: physicsKeys.outage(scope),
    queryFn: ({ signal }) => request<OutageAutobiography>(scopedPath('/physics/outage', scope), { signal }),
    enabled: !!vehicleId,
    ...queryPolicy('operational'),
  });
}

export function useSessionCertificate(vehicleId: string | undefined) {
  const scope: QueryScope = { vehicleId: vehicleId ?? null };
  return useQuery({
    queryKey: physicsKeys.certificate(scope),
    queryFn: ({ signal }) => request<SessionCertificate>(scopedPath('/physics/certificate', scope), { signal }),
    enabled: !!vehicleId,
    ...queryPolicy('historical'),
  });
}
