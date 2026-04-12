import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import type { Alert, AlertRule, NotificationChannel, NotificationLog, NotificationStats } from '@/types/admin';

export const notificationKeys = {
  alerts: ['alerts'] as const,
  alertRules: ['alert-rules'] as const,
  channels: ['notification-channels'] as const,
  logs: ['notification-logs'] as const,
  stats: ['notification-stats'] as const,
};

export function useAlerts() {
  return useQuery({
    queryKey: notificationKeys.alerts,
    queryFn: () => request<Alert[]>('/api/v1/alerts'),
    refetchInterval: 30_000,
  });
}

export function useMarkAlertRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/api/v1/alerts/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.alerts }),
  });
}

export function useAlertRules() {
  return useQuery({
    queryKey: notificationKeys.alertRules,
    queryFn: () => request<AlertRule[]>('/api/v1/alert-rules'),
  });
}

export function useSaveAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<AlertRule>) =>
      request<AlertRule>(data.id ? `/api/v1/alert-rules/${data.id}` : '/api/v1/alert-rules', {
        method: data.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.alertRules }),
  });
}

export function useDeleteAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/api/v1/alert-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.alertRules }),
  });
}

export function useNotificationChannels() {
  return useQuery({
    queryKey: notificationKeys.channels,
    queryFn: () => request<NotificationChannel[]>('/api/v1/notifications/channels'),
  });
}

export function useNotificationLogs() {
  return useQuery({
    queryKey: notificationKeys.logs,
    queryFn: () => request<NotificationLog[]>('/api/v1/notifications/logs'),
  });
}

export function useNotificationStats() {
  return useQuery({
    queryKey: notificationKeys.stats,
    queryFn: () => request<NotificationStats>('/api/v1/notifications/stats'),
    refetchInterval: 30_000,
  });
}

export function useSaveChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<NotificationChannel>) =>
      request<NotificationChannel>(
        data.id ? `/api/v1/notifications/channels/${data.id}` : '/api/v1/notifications/channels',
        {
          method: data.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.channels }),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/api/v1/notifications/channels/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.channels }),
  });
}
