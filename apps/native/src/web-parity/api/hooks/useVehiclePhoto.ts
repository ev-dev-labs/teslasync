// Vehicle photo upload hook.
//
// Native parity keeps the TanStack Query contracts and backend paths from the
// web hook. Browser File objects are represented by Blob-compatible values or
// React Native {uri,name,type,size} file descriptors so multipart uploads do
// not depend on DOM-only APIs.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import {apiUrl, request} from '../client';

/** Multipart form field name the backend expects on the upload. */
export const VEHICLE_PHOTO_FORM_FIELD = 'photo';

/** Client-side hard cap mirroring the backend's MaxUploadBytes. */
export const VEHICLE_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Allowed MIME types - matches AllowedPhotoMimeTypes server-side. WebP remains
 * intentionally absent because the backend stdlib decode path excludes it.
 */
export const VEHICLE_PHOTO_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

export const nativeVehiclePhotoCapabilities = {
  metadataEndpointAvailable: true,
  uploadEndpointAvailable: true,
  deleteEndpointAvailable: true,
  nativeFileDescriptorUploadAvailable: true,
  browserFileApiAvailable: false,
  queryBroadcastAvailable: false,
} as const;

export type VehiclePhotoSize = 'thumb' | 'medium' | 'full';

export interface VehiclePhotoSizes {
  thumb: VehiclePhotoSize;
  medium: VehiclePhotoSize;
  full: VehiclePhotoSize;
}

export interface VehiclePhotoMeta {
  has_photo: boolean;
  uploaded_at?: string;
  sizes?: VehiclePhotoSizes;
}

export interface NativeVehiclePhotoFile {
  uri: string;
  name: string;
  type?: string;
  size?: number;
}

export type VehiclePhotoUploadFile = (Blob & {name?: string}) | NativeVehiclePhotoFile;

export const vehiclePhotoKeys = {
  all: ['vehicle-photos'] as const,
  detail: (vehicleId: number) => ['vehicle-photos', vehicleId] as const,
};

const vehicleKeys = {
  detail: (id: string) => ['vehicles', id] as const,
};

function invalidateAndBroadcast(
  qc: QueryClient,
  filters: {queryKey: QueryKey},
): void {
  void qc.invalidateQueries(filters);
}

function isNativeVehiclePhotoFile(
  file: VehiclePhotoUploadFile,
): file is NativeVehiclePhotoFile {
  return (
    typeof file === 'object' &&
    file !== null &&
    'uri' in file &&
    typeof file.uri === 'string' &&
    'name' in file &&
    typeof file.name === 'string'
  );
}

function vehiclePhotoFileSize(file: VehiclePhotoUploadFile): number | undefined {
  return typeof file.size === 'number' ? file.size : undefined;
}

function vehiclePhotoFileType(file: VehiclePhotoUploadFile): string {
  return typeof file.type === 'string' ? file.type : '';
}

function appendVehiclePhotoFile(
  form: FormData,
  file: VehiclePhotoUploadFile,
): void {
  if (isNativeVehiclePhotoFile(file)) {
    form.append(VEHICLE_PHOTO_FORM_FIELD, {
      uri: file.uri,
      name: file.name,
      type: file.type ?? 'application/octet-stream',
    } as unknown as Blob);
    return;
  }

  form.append(VEHICLE_PHOTO_FORM_FIELD, file);
}

/**
 * Builds the URL for a rendered photo size. Pass the meta's `uploaded_at` so a
 * re-upload busts the image cache without changing the deterministic backend
 * path. Returns null when the meta says the vehicle has no photo.
 */
export function vehiclePhotoUrl(
  vehicleId: number,
  size: VehiclePhotoSize,
  meta: VehiclePhotoMeta | null | undefined,
): string | null {
  if (!meta || !meta.has_photo) {
    return null;
  }

  const base = apiUrl(`/vehicles/${vehicleId}/photo/${size}`);
  if (!meta.uploaded_at) {
    return base;
  }

  const ts = Date.parse(meta.uploaded_at);
  if (Number.isNaN(ts)) {
    return base;
  }

  return `${base}?v=${ts}`;
}

/**
 * Fetches the photo metadata for a single vehicle. The backend returns
 * {has_photo:false} instead of 404 for the absent-photo case.
 */
export function useVehiclePhoto(vehicleId: number | null | undefined) {
  return useQuery({
    queryKey:
      vehicleId == null ? vehiclePhotoKeys.all : vehiclePhotoKeys.detail(vehicleId),
    queryFn: ({signal}) =>
      request<VehiclePhotoMeta>(`/vehicles/${vehicleId}/photo`, {signal}),
    enabled: vehicleId != null,
    staleTime: 60_000,
  });
}

/**
 * Validates a candidate file against the size + mime constraints. Native URI
 * descriptors may not expose size, so size validation is applied when known and
 * the backend remains authoritative for unknown sizes.
 */
export interface VehiclePhotoValidationError {
  reason: 'mime' | 'size' | 'empty';
  message: string;
}

export function validateVehiclePhotoFile(
  file: VehiclePhotoUploadFile | null | undefined,
): VehiclePhotoValidationError | null {
  if (!file) {
    return {reason: 'empty', message: 'No file selected.'};
  }

  const size = vehiclePhotoFileSize(file);
  if (size != null && size <= 0) {
    return {reason: 'empty', message: 'Selected file is empty.'};
  }

  if (size != null && size > VEHICLE_PHOTO_MAX_BYTES) {
    return {
      reason: 'size',
      message: `Photo exceeds ${(VEHICLE_PHOTO_MAX_BYTES / (1024 * 1024)).toFixed(
        0,
      )} MB limit.`,
    };
  }

  const type = vehiclePhotoFileType(file);
  if (type && !VEHICLE_PHOTO_ALLOWED_MIME.has(type.toLowerCase())) {
    return {reason: 'mime', message: `Unsupported image type: ${type}`};
  }

  return null;
}

export interface UploadVehiclePhotoArgs {
  vehicleId: number;
  file: VehiclePhotoUploadFile;
}

async function parseUploadError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {error?: string; code?: string};
    return body.error || body.code || '';
  } catch {
    return '';
  }
}

/**
 * POST multipart upload mutation. The direct fetch bypass is intentional: the
 * shared request() client sets application/json for any non-null body, which
 * would corrupt the multipart boundary.
 */
export function useUploadVehiclePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({vehicleId, file}: UploadVehiclePhotoArgs) => {
      const validation = validateVehiclePhotoFile(file);
      if (validation) {
        throw new Error(validation.message);
      }

      const form = new FormData();
      appendVehiclePhotoFile(form, file);

      const res = await fetch(apiUrl(`/vehicles/${vehicleId}/photo`), {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: {Accept: 'application/json'},
      });

      if (!res.ok) {
        const detail = await parseUploadError(res);
        throw new Error(detail || `Upload failed (${res.status})`);
      }

      return (await res.json()) as VehiclePhotoMeta;
    },
    onSuccess: (data, vars) => {
      queryClient.setQueryData(vehiclePhotoKeys.detail(vars.vehicleId), data);
      invalidateAndBroadcast(queryClient, {
        queryKey: vehiclePhotoKeys.detail(vars.vehicleId),
      });
      invalidateAndBroadcast(queryClient, {
        queryKey: vehicleKeys.detail(String(vars.vehicleId)),
      });
    },
  });
}

/**
 * DELETE mutation. Idempotent on the backend (204 even when no row exists), so
 * callers can render remove-photo actions without pre-checking existence.
 */
export function useDeleteVehiclePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vehicleId: number) => {
      await request<void>(`/vehicles/${vehicleId}/photo`, {method: 'DELETE'});
      return vehicleId;
    },
    onSuccess: vehicleId => {
      queryClient.setQueryData<VehiclePhotoMeta>(vehiclePhotoKeys.detail(vehicleId), {
        has_photo: false,
      });
      invalidateAndBroadcast(queryClient, {
        queryKey: vehiclePhotoKeys.detail(vehicleId),
      });
      invalidateAndBroadcast(queryClient, {
        queryKey: vehicleKeys.detail(String(vehicleId)),
      });
    },
  });
}
