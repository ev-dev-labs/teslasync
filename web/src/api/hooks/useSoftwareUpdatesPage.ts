import { useQuery } from '@tanstack/react-query';
import { request } from '@/api/client';
import type { SoftwareUpdate } from '@/api/types';

export type { SoftwareUpdate } from '@/api/types';

export const PAGE_SIZE = 50;

/**
 * Pass shared RFC 3339 bounds through unchanged: start is inclusive and end
 * is exclusive. The server adapts the end for its inclusive SQL predicate.
 */
export function useSoftwareUpdatesPage(
  vehicleId: number | null,
  page: number,
  startInstant: string,
  endInstantExclusive: string,
) {
  return useQuery({
    queryKey: ['software-updates', vehicleId, page, startInstant, endInstantExclusive],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        vehicle_id: String(vehicleId),
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
        start: startInstant,
        end: endInstantExclusive,
      });
      return request<SoftwareUpdate[]>(`/software-updates?${params.toString()}`, { signal });
    },
    enabled: vehicleId !== null,
  });
}
