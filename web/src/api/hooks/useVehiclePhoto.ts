// Vehicle photo upload hook.
//
// Surfaces three React-Query primitives for the SPA's
// <VehiclePhotoUpload> + <VehicleHeroCard>:
//
//   - useVehiclePhoto(vehicleId)   → metadata query (has_photo, uploaded_at)
//   - useUploadVehiclePhoto()      → POST multipart upload mutation
//   - useDeleteVehiclePhoto()      → DELETE mutation
//
// Plus the URL builder vehiclePhotoUrl() that the hero card and
// lightbox use to render <img src=...>. The builder threads
// uploaded_at through the URL as ?v= so a re-upload busts the
// browser cache without changing the deterministic backend path.
//
// Why bypass request():
//
//   web/src/api/client.ts:62-66 unconditionally sets
//   Content-Type: application/json on any non-null body, which
//   would mangle the multipart boundary header that browsers fill
//   in automatically. The upload mutation calls fetch() directly
//   for that reason; everything else (GET/DELETE) goes through
//   request() to keep the resilience + auth interceptors.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiUrl, request } from '@/api/client';
import type { VehiclePhotoMeta, VehiclePhotoSize } from '@/api/types';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';

import { vehicleKeys } from './useVehicles';

/** Multipart form field name the backend expects on the upload. */
export const VEHICLE_PHOTO_FORM_FIELD = 'photo';

/** Client-side hard cap mirroring the backend's MaxUploadBytes. */
export const VEHICLE_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

/** Allowed MIME types — matches AllowedPhotoMimeTypes server-side.
 * NOTE: WebP is intentionally absent — see internal/imaging package
 * doc. The pure-stdlib decode path doesn't include a WebP decoder. */
export const VEHICLE_PHOTO_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

export const vehiclePhotoKeys = {
  all: ['vehicle-photos'] as const,
  detail: (vehicleId: number) => ['vehicle-photos', vehicleId] as const,
};

/**
 * Builds the URL for a rendered photo size. Pass the meta's
 * `uploaded_at` so a re-upload busts the browser cache — the
 * backend path is deterministic per upload but the SPA has no
 * other signal that the bytes changed.
 *
 * Returns `null` when the meta says the vehicle has no photo;
 * callers can use the falsy return as the "fall back to stock
 * render" branch.
 */
export function vehiclePhotoUrl(
  vehicleId: number,
  size: VehiclePhotoSize,
  meta: VehiclePhotoMeta | null | undefined,
): string | null {
  if (!meta || !meta.has_photo) return null;
  // A non-finite id (NaN from a bad `Number(...)`, Infinity) would render a
  // broken `/vehicles/NaN/photo/...` <img src>. Treat it like "no photo" so
  // the caller falls back to the stock render instead of a 404'd image.
  if (!Number.isFinite(vehicleId)) return null;
  const base = apiUrl(`/vehicles/${vehicleId}/photo/${size}`);
  if (!meta.uploaded_at) return base;
  const ts = Date.parse(meta.uploaded_at);
  if (Number.isNaN(ts)) return base;
  return `${base}?v=${ts}`;
}

/**
 * Fetches the photo metadata for a single vehicle.
 *
 * The backend always returns 200 — `has_photo:false` is the
 * "no photo" signal, NOT a 404 — so the hook never enters the
 * error state for the absent-photo case. That keeps the
 * <VehicleHeroCard> render tree a simple ternary instead of a
 * three-way (loading/error/data) branch.
 */
export function useVehiclePhoto(vehicleId: number | null | undefined) {
  // Normalise to a valid numeric id or null. `vehicleId != null` alone let a
  // NaN (e.g. from `Number(undefined)`) slip through as "enabled", firing a
  // doomed request to `/vehicles/NaN/photo`. Collapsing non-finite values to
  // null keeps the query disabled and the key stable.
  const numericId =
    typeof vehicleId === 'number' && Number.isFinite(vehicleId) ? vehicleId : null;
  return useQuery({
    queryKey: numericId == null ? vehiclePhotoKeys.all : vehiclePhotoKeys.detail(numericId),
    queryFn: ({ signal }) =>
      request<VehiclePhotoMeta>(`/vehicles/${numericId}/photo`, { signal }),
    enabled: numericId != null,
    staleTime: 60_000,
  });
}

/**
 * Validates a candidate file against the size + mime constraints.
 * Surfaced as a helper so the upload component can show a toast
 * BEFORE firing a doomed request.
 */
export interface VehiclePhotoValidationError {
  reason: 'mime' | 'size' | 'empty';
  message: string;
}

export function validateVehiclePhotoFile(file: File | null | undefined): VehiclePhotoValidationError | null {
  if (!file) return { reason: 'empty', message: 'No file selected.' };
  if (file.size <= 0) return { reason: 'empty', message: 'Selected file is empty.' };
  if (file.size > VEHICLE_PHOTO_MAX_BYTES) {
    return {
      reason: 'size',
      message: `Photo exceeds ${(VEHICLE_PHOTO_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB limit.`,
    };
  }
  // Some browsers omit the type for unusual extensions; only
  // reject when a type IS supplied AND it's outside the allowed
  // set. The server still does the authoritative check.
  if (file.type && !VEHICLE_PHOTO_ALLOWED_MIME.has(file.type.toLowerCase())) {
    return { reason: 'mime', message: `Unsupported image type: ${file.type}` };
  }
  return null;
}

export interface UploadVehiclePhotoArgs {
  vehicleId: number;
  file: File;
}

/**
 * POST multipart upload mutation. Returns the new metadata so the
 * caller can swap the cache without waiting for the invalidate.
 *
 * The fetch() bypass is INTENTIONAL — see the header comment.
 */
export function useUploadVehiclePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ vehicleId, file }: UploadVehiclePhotoArgs) => {
      const validation = validateVehiclePhotoFile(file);
      if (validation) throw new Error(validation.message);
      const form = new FormData();
      form.append(VEHICLE_PHOTO_FORM_FIELD, file, file.name);
      const res = await fetch(apiUrl(`/vehicles/${vehicleId}/photo`), {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      if (!res.ok) {
        let detail = '';
        try {
          const body = (await res.json()) as { error?: string; code?: string };
          detail = body.error || body.code || '';
        } catch {
          // non-JSON error body — fall through with status text.
        }
        throw new Error(detail || `Upload failed (${res.status})`);
      }
      return (await res.json()) as VehiclePhotoMeta;
    },
    onSuccess: (data, vars) => {
      queryClient.setQueryData(vehiclePhotoKeys.detail(vars.vehicleId), data);
      invalidateAndBroadcast(queryClient, { queryKey: vehiclePhotoKeys.detail(vars.vehicleId) });
      invalidateAndBroadcast(queryClient, { queryKey: vehicleKeys.detail(String(vars.vehicleId)) });
    },
  });
}

/**
 * DELETE mutation. Idempotent on the backend (204 even when no
 * row exists) so the SPA can render a "remove photo" button
 * without pre-checking existence.
 */
export function useDeleteVehiclePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vehicleId: number) => {
      await request<void>(`/vehicles/${vehicleId}/photo`, { method: 'DELETE' });
      return vehicleId;
    },
    onSuccess: (vehicleId) => {
      invalidateAndBroadcast(queryClient, { queryKey: vehiclePhotoKeys.detail(vehicleId) });
      invalidateAndBroadcast(queryClient, { queryKey: vehicleKeys.detail(String(vehicleId)) });
      queryClient.setQueryData<VehiclePhotoMeta>(
        vehiclePhotoKeys.detail(vehicleId),
        { has_photo: false },
      );
    },
  });
}
