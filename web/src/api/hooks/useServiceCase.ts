import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CaseReview, PrivateServiceCase, ServiceCaseEntry, ServiceCaseSelection } from '@/types/serviceCase';
import { isApiError, request } from '../client';
import { actionCenterKeys } from './useActionCenter';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

export type ServiceCaseKey = Pick<PrivateServiceCase, 'id' | 'version'>;
type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change = { kind: 'save'; key: ServiceCaseKey; title: string }
  | { kind: 'delete'; key: ServiceCaseKey }
  | { kind: 'add'; key: ServiceCaseKey; entry: ServiceCaseEntry }
  | { kind: 'remove'; key: ServiceCaseKey; id: number };
type ReviewInput = { key: ServiceCaseKey; selection: ServiceCaseSelection[]; signal: AbortSignal };
type ReviewOperation = (ReviewInput & { kind: 'preview' }) | (ReviewInput & { kind: 'export'; digest: string });

const caseKey = (scope: Scope, vehicle: number) => ['private-service-case', scope, vehicle] as const;
const bodyKey = (key: ServiceCaseKey) => ({ expected_case_id: key.id, expected_version: key.version });

export function useServiceCase(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: caseKey(scope, vehicle),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: PrivateServiceCase }>(`/service-intelligence/service-case?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useServiceCaseChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      const { id, version } = change.key;
      switch (change.kind) {
        case 'save': return request<void>(`/service-intelligence/service-case?vehicle_id=${vehicle}`, {
          ...options, method: 'PUT', body: JSON.stringify({ ...bodyKey(change.key), title: change.title }),
        });
        case 'delete': return request<void>(`/service-intelligence/service-case?vehicle_id=${vehicle}&case_id=${id}&version=${version}`, {
          ...options, method: 'DELETE',
        });
        case 'add': return request<void>(`/service-intelligence/service-case/evidence?vehicle_id=${vehicle}`, {
          ...options, method: 'POST', body: JSON.stringify({ ...bodyKey(change.key), ...change.entry }),
        });
        case 'remove': return request<void>(`/service-intelligence/service-case/evidence/${change.id}?vehicle_id=${vehicle}&case_id=${id}&version=${version}`, {
          ...options, method: 'DELETE',
        });
      }
    },
    networkMode: 'always',
    retry: false,
    gcTime: 0,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey });
      }
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: caseKey(scope, vehicle) }),
        client.invalidateQueries({ queryKey: actionCenterKeys.all }),
      ]);
    },
  });
}

export function useServiceCaseReview(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (operation: ReviewOperation) => {
      const selection = { ...bodyKey(operation.key), selection: operation.selection };
      const options = {
        signal: operation.signal, method: 'POST', cache: 'no-store',
        requiresLiveMode: true, headers: expectedPrincipalHeader(scope),
      } as const;
      if (operation.kind === 'preview') {
        const { data } = await request<{ data: CaseReview }>(`/service-intelligence/service-case/preview?vehicle_id=${vehicle}`, {
          ...options, body: JSON.stringify(selection),
        });
        return { kind: 'preview' as const, data };
      }
      const data = await request<string>(`/service-intelligence/service-case/export?vehicle_id=${vehicle}`, {
        ...options, responseType: 'text', body: JSON.stringify({ ...selection, reviewed_digest: operation.digest }),
      });
      return { kind: 'export' as const, data };
    },
    networkMode: 'always',
    retry: false,
    gcTime: 0,
    onError: error => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey });
      }
      if (isApiError(error) && [401, 403, 404, 409].includes(error.status)) {
        void client.invalidateQueries({ queryKey: caseKey(scope, vehicle) });
      }
    },
  });
}
