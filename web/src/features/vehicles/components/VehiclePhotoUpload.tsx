// Vehicle photo upload UI.
//
// Drag-drop / file-picker zone + thumbnail preview + upload progress
// + delete button. Wires into:
//
//   - useVehiclePhoto         → current metadata (drives the "remove" button)
//   - useUploadVehiclePhoto   → POST multipart, invalidates the photo query
//   - useDeleteVehiclePhoto   → DELETE, idempotent
//
// Client-side validation mirrors the backend (8 MB cap, JPEG/PNG)
// so the user gets an instant toast on a bad file rather than waiting
// for the round-trip 415/413.
//
// No new image library — the preview uses a plain <img> bound to a
// FileReader-produced data URL. Rotation/crop can be added later
// without changing the component contract.

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useDeleteVehiclePhoto,
  useUploadVehiclePhoto,
  useVehiclePhoto,
  validateVehiclePhotoFile,
  vehiclePhotoUrl,
  VEHICLE_PHOTO_ALLOWED_MIME,
  VEHICLE_PHOTO_MAX_BYTES,
} from '@/api/hooks/useVehiclePhoto';
import { Button, ConfirmDialog, GlassPanel, Input } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { useToast } from '@/components/feedback/Toast';
import { cn } from '@/lib/cn';

export interface VehiclePhotoUploadProps {
  vehicleId: number;
  className?: string;
}

const ACCEPT_ATTR = Array.from(VEHICLE_PHOTO_ALLOWED_MIME).join(',');

export function VehiclePhotoUpload({ vehicleId, className }: VehiclePhotoUploadProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const meta = useVehiclePhoto(vehicleId);
  const upload = useUploadVehiclePhoto();
  const remove = useDeleteVehiclePhoto();

  // Free the preview Object URL when the component unmounts or
  // when a new preview replaces the prior one. URL.createObjectURL
  // leaks the underlying File until revoked.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const startUpload = useCallback(
    (file: File) => {
      const validation = validateVehiclePhotoFile(file);
      if (validation) {
        toast.error(validation.message);
        return;
      }
      // Build a preview for instant feedback while the upload runs.
      const url = URL.createObjectURL(file);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      upload.mutate(
        { vehicleId, file },
        {
          onSuccess: () => {
            toast.success(t('vehicles.photos.uploadSuccess', 'Photo uploaded.'));
            setPreviewUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          },
          onError: (err) => {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(message || t('vehicles.photos.uploadFailed', 'Photo upload failed.'));
            setPreviewUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          },
        },
      );
    },
    [upload, vehicleId, toast, t],
  );

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset the input so the same file can be picked again after
      // an error — browsers suppress the change event when the
      // value is unchanged.
      e.target.value = '';
      if (file) startUpload(file);
    },
    [startUpload],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) startUpload(file);
    },
    [startUpload],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragActive(false);
  }, []);

  const handleRemove = useCallback(() => {
    remove.mutate(vehicleId, {
      onSuccess: () => {
        toast.success(t('vehicles.photos.deleteSuccess', 'Photo removed.'));
        setConfirmDelete(false);
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(message || t('vehicles.photos.deleteFailed', 'Failed to remove photo.'));
      },
    });
  }, [remove, vehicleId, toast, t]);

  const isUploading = upload.isPending;
  const hasPhoto = Boolean(meta.data?.has_photo);
  const currentUrl =
    previewUrl ??
    (meta.data ? vehiclePhotoUrl(vehicleId, 'medium', meta.data) : null);

  const maxMB = (VEHICLE_PHOTO_MAX_BYTES / (1024 * 1024)).toFixed(0);

  return (
    <GlassPanel className={cn('p-4 space-y-4', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">
          {t('vehicles.photos.upload.title', 'Vehicle photo')}
        </h3>
      </div>

      <div
        data-testid="vehicle-photo-dropzone"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 transition-colors',
          dragActive
            ? 'border-cyan-400 bg-cyan-500/10'
            : 'border-[var(--border-subtle)] bg-[var(--surface-2)]',
        )}
      >
        {meta.isLoading ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t('vehicles.photos.loading', 'Loading vehicle photo…')}
            className="w-full space-y-3"
          >
            <Skeleton className="mx-auto h-36 w-full max-w-sm rounded-lg" />
            <Skeleton className="mx-auto h-4 w-48" />
          </div>
        ) : currentUrl ? (
          <img
            data-testid="vehicle-photo-preview"
            src={currentUrl}
            alt={t('vehicles.photos.upload.previewAlt', 'Vehicle photo preview')}
            className="max-h-48 rounded-lg object-cover"
          />
        ) : (
          <p className="text-sm text-[var(--text-secondary)]">
            {t('vehicles.photos.upload.dropPrompt', 'Drag a photo here or click to choose a file')}
          </p>
        )}

        <p className="text-xs text-[var(--text-muted)]">
          {t('vehicles.photos.upload.constraints', 'JPEG or PNG — up to {{max}} MB', { max: maxMB })}
        </p>

        <Input
          ref={fileInputRef}
          data-testid="vehicle-photo-input"
          type="file"
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            data-testid="vehicle-photo-choose"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            loading={isUploading}
            variant="primary"
            size="sm"
          >
            {isUploading
              ? t('vehicles.photos.upload.uploading', 'Uploading…')
              : hasPhoto
                ? t('vehicles.photos.upload.replace', 'Replace photo')
                : t('vehicles.photos.upload.choose', 'Choose photo')}
          </Button>
          {hasPhoto ? (
            <Button
              data-testid="vehicle-photo-remove"
              onClick={() => setConfirmDelete(true)}
              disabled={isUploading || remove.isPending}
              variant="ghost"
              size="sm"
            >
              {t('vehicles.photos.upload.remove', 'Remove photo')}
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleRemove}
        title={t('vehicles.photos.upload.confirmRemoveTitle', 'Remove vehicle photo?')}
        message={t(
          'vehicles.photos.upload.confirmRemoveMessage',
          'The hero card will fall back to the stock model render until a new photo is uploaded.',
        )}
        confirmLabel={t('common.remove', 'Remove')}
        variant="danger"
        loading={remove.isPending}
      />
    </GlassPanel>
  );
}
