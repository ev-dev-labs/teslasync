import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { useToast } from '@/components/feedback/Toast';
import type { ExportJob } from '@/types/export';

export const exportKeys = {
  all: ['exports'] as const,
  detail: (id: string) => ['exports', id] as const,
};

export function useExports() {
  return useQuery({
    queryKey: exportKeys.all,
    queryFn: () => request<ExportJob[]>('/export/jobs'),
    select: safeArray,
  });
}

export function useExport(id: string) {
  return useQuery({
    queryKey: exportKeys.detail(id),
    queryFn: () => request<ExportJob>(`/exports/${id}`),
    enabled: !!id,
  });
}

export function useCreateExport() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (data: { format: string; vehicleId: string; dateFrom: string; dateTo: string }) =>
      request<ExportJob>('/exports', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: exportKeys.all });
      toast.success('Export started');
    },
    onError: (err: Error) => {
      toast.error(`Failed to start export: ${err.message}`);
    },
  });
}
