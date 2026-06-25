import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import {isApiError, request, setCachedSudoToken, type ApiError} from '../client';
import type {
  TOTPBackupCodesResponse,
  TOTPEnrollment,
  TOTPStatus,
  TOTPSudoToken,
} from '../../../api/types';
import {useMutationToast} from './_toastHelpers';

export type {
  TOTPBackupCodesResponse,
  TOTPEnrollment,
  TOTPStatus,
  TOTPSudoToken,
} from '../../../api/types';

export const nativeTOTPHookCapabilities = {
  queryBroadcastAvailable: false,
  localQueryInvalidation: true,
  mutationFeedbackPrimitive: 'Alert.alert',
  sudoTokenCacheAvailable: true,
  authModeOpenHandledAsData: true,
} as const;

function invalidateAndBroadcast(
  qc: QueryClient,
  filters: {queryKey: QueryKey},
): void {
  void qc.invalidateQueries(filters);
}

export const totpKeys = {
  status: ['totp', 'status'] as const,
};

const AUTH_MODE_OPEN_CODE = 'AUTH_MODE_OPEN';

export const TOTP_RATE_LIMITED_CODE = 'TOTP_RATE_LIMITED';

export const TOTP_INVALID_CODE = 'TOTP_INVALID';

export const TOTP_ENROLLMENT_EXPIRED_CODE = 'TOTP_ENROLLMENT_EXPIRED';

export function useTOTPStatus(options?: {enabled?: boolean}) {
  return useQuery<TOTPStatus, ApiError>({
    queryKey: totpKeys.status,
    queryFn: async ({signal}) => {
      try {
        return await request<TOTPStatus>('/auth/totp', {signal});
      } catch (err) {
        if (isApiError(err) && err.code === AUTH_MODE_OPEN_CODE) {
          return {mode: 'open'} as TOTPStatus;
        }
        throw err;
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });
}

export function useTOTPEnroll() {
  const qc = useQueryClient();
  const toast = useMutationToast();

  return useMutation<TOTPEnrollment, ApiError, void>({
    mutationFn: () =>
      request<TOTPEnrollment>('/auth/totp/enroll', {method: 'POST'}),
    onSuccess: () => {
      invalidateAndBroadcast(qc, {queryKey: totpKeys.status});
    },
    onError: err =>
      toast.error(
        err,
        'settings.totp.errors.enroll',
        'Failed to start TOTP enrollment',
      ),
  });
}

export function useTOTPVerify() {
  const qc = useQueryClient();
  const toast = useMutationToast();

  return useMutation<{activated: boolean}, ApiError, {code: string}>({
    mutationFn: ({code}) =>
      request<{activated: boolean}>('/auth/totp/verify', {
        method: 'POST',
        body: JSON.stringify({code}),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, {queryKey: totpKeys.status});
      toast.success(
        'settings.totp.toasts.verified',
        'TOTP enabled. Save your backup codes!',
      );
    },
    onError: err =>
      toast.error(err, 'settings.totp.errors.verify', 'Verification failed'),
  });
}

export function useTOTPStepUp() {
  return useMutation<
    TOTPSudoToken,
    ApiError,
    {code?: string; backup_code?: string}
  >({
    mutationFn: async ({code, backup_code}) => {
      const body: Record<string, string> = {};
      if (code) {
        body.code = code;
      }
      if (backup_code) {
        body.backup_code = backup_code;
      }

      const result = await request<TOTPSudoToken>('/auth/totp/sudo', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setCachedSudoToken({
        token: result.sudo_token,
        expiresAtMs: new Date(result.expires_at).getTime(),
      });
      return result;
    },
  });
}

export function useTOTPRevoke() {
  const qc = useQueryClient();
  const toast = useMutationToast();

  return useMutation<void, ApiError, void>({
    mutationFn: () => request<void>('/auth/totp', {method: 'DELETE'}),
    onSuccess: () => {
      invalidateAndBroadcast(qc, {queryKey: totpKeys.status});
      toast.success('settings.totp.toasts.disabled', 'TOTP disabled.');
    },
    onError: err =>
      toast.error(
        err,
        'settings.totp.errors.disable',
        'Failed to disable TOTP',
      ),
  });
}

export function useTOTPRegenerateBackupCodes() {
  const qc = useQueryClient();
  const toast = useMutationToast();

  return useMutation<TOTPBackupCodesResponse, ApiError, void>({
    mutationFn: () =>
      request<TOTPBackupCodesResponse>('/auth/totp/backup-codes/regenerate', {
        method: 'POST',
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, {queryKey: totpKeys.status});
      toast.success(
        'settings.totp.toasts.backupRegenerated',
        'Backup codes regenerated.',
      );
    },
    onError: err =>
      toast.error(
        err,
        'settings.totp.errors.regenerate',
        'Failed to regenerate backup codes',
      ),
  });
}
