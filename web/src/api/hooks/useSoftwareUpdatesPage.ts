import { useQuery } from '@tanstack/react-query';
import { request } from '@/api/client';
import type { SoftwareUpdate } from '@/api/types';

export type { SoftwareUpdate } from '@/api/types';

export const PAGE_SIZE = 50;

/**
 * Exact extraction of SoftwareUpdatesPage's inline query. Range strings and
 * numeric operands are intentionally passed through; policy belongs to the
 * QueryClient and presentation/defensive coercion belongs to the page.
 */
export function useSoftwareUpdatesPage(
  vehicleId: number | null,
  page: number,
  start: string,
  end: string,
) {
  return useQuery({
    queryKey: ['software-updates', vehicleId, page, start, end],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        vehicle_id: String(vehicleId),
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
        start,
        end,
      });
      return request<SoftwareUpdate[]>(`/software-updates?${params.toString()}`, { signal });
    },
    enabled: vehicleId !== null,
  });
}
