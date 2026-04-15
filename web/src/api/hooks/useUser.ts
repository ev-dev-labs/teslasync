import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import type { User } from '@/types/user';

export const userKeys = {
  me: ['users', 'me'] as const,
};

export function useCurrentUser() {
  return useQuery({
    queryKey: userKeys.me,
    queryFn: () => request<User>('/users/me'),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { displayName: string }) =>
      request<User>('/users/me', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (data) => {
      queryClient.setQueryData(userKeys.me, data);
    },
  });
}
