// Native parity port of
// web/src/features/vehicles/components/VehiclePhotoUpload.tsx.
//
// `VehiclePhotoUpload` is the vehicle photo upload card: a GlassPanel (p-4,
// space-y-4) with a header (title + a spinner while the metadata query loads), a
// dashed "dropzone" that shows either the current/preview image or a prompt plus
// a JPEG/PNG size-cap caption, a "Choose/Replace photo" + "Remove photo" action
// row, and a destructive ConfirmDialog gating the delete. It wires into three
// TanStack Query primitives:
//   - useVehiclePhoto         -> current metadata (drives the "remove" button)
//   - useUploadVehiclePhoto   -> POST multipart, invalidates the photo query
//   - useDeleteVehiclePhoto   -> DELETE, idempotent
// Client-side validation (8 MB cap, JPEG/PNG) mirrors the backend so a bad file
// shows an instant toast rather than waiting for a 415/413 round-trip.
//
// Every state name (`previewUrl`, `dragActive`, `confirmDelete`), derived value
// (`isUploading`, `hasPhoto`, `currentUrl`, `maxMB`), hook handle (`meta`,
// `upload`, `remove`), the `validateVehiclePhotoFile` / `vehiclePhotoUrl` /
// `VEHICLE_PHOTO_ALLOWED_MIME` / `VEHICLE_PHOTO_MAX_BYTES` reads, the
// `upload.mutate({vehicleId, file}, {onSuccess, onError})` /
// `remove.mutate(vehicleId, {onSuccess, onError})` flows, the object-URL
// create/revoke preview lifecycle, and every `t(key, 'English'[, vars])` i18n
// key + fallback are preserved verbatim.
//
// Web modules -> native-safe mappings (conversion contract rules 4-7), each
// noted in the parity sidecar:
//   - react-i18next `useTranslation` (L19) -> a local key-preserving shim
//     returning the inline English copy (no react-i18next in the native deps;
//     the established sibling-port approach). The shim also performs the web
//     `{{max}}` interpolation so the constraints string renders identically.
//   - `@/api/hooks/useVehiclePhoto` (L21-29) -> the already-ported native
//     web-parity hook (same query/mutation contracts + backend paths). The web
//     `File` argument is widened to the hook's `VehiclePhotoUploadFile`
//     (Blob-with-name OR a `{uri,name,type,size}` native descriptor) so uploads
//     do not depend on the DOM File API.
//   - `@/components/ui/Button` (L30) -> a local `ActionButton` Pressable
//     (variant primary|ghost, size sm) — no ported Button host exists; the
//     primary/ghost + sm contract used here is reproduced.
//   - `@/components/ui/ConfirmDialog` (L31) -> a local native `ConfirmDialog`
//     built on the RN `Modal` (the AiConfirmDialog precedent), covering exactly
//     the props this call site passes (open/onCancel/onConfirm/title/message/
//     confirmLabel/variant='danger'/loading). The web dialog's extra
//     features (typed-confirmation, silence) are unused here and omitted.
//   - `@/components/ui/GlassPanel` (L32) -> the shared native GlassPanel.
//   - `@/components/feedback/Spinner` (L33) -> the RN `ActivityIndicator`.
//   - `@/components/feedback/Toast` useToast (L34) -> a local in-panel banner
//     host preserving the single-arg `success(title)` / `error(message)`
//     contract (the RegionSettings precedent).
//   - `@/lib/cn` (L35) -> dropped: React Native has no className; static class
//     styling moves to StyleSheet and the `className` prop is retained for
//     source compatibility but ignored.
//
// Browser-only behaviours -> explicit native-safe handling (rule 7):
//   - Drag-and-drop (DOM DragEvent, L114-131) has no React Native analog. The
//     `dragActive` state is kept for parity but, with no native drag events to
//     flip it, stays false; the dropzone renders its idle border. The
//     `handleDrop` / `handleDragOver` / `handleDragLeave` handlers and their
//     DOM event types are omitted (documented), with the inactive/active border
//     styles preserved as visual intent.
//   - `<input type="file">` + `fileInputRef` + `handleFileChange` (L18 ref,
//     L47, L102-112, L194-201): there is no DOM file input and apps/native
//     bundles no image picker, so interactive selection is UNAVAILABLE on a true
//     native target. `handleChoose` resolves an optional host-injected picker
//     (the PrintButton `performPrint` "invoke only when present" pattern) so a
//     future picker / react-native-web host can supply real files; when none
//     exists it surfaces the explicit unavailable state via `toast.error`.
//   - `URL.createObjectURL` / `URL.revokeObjectURL` (L61, L73-77, L83-86,
//     L91-94): a picked native file is already addressable by its `uri` (used
//     directly as the preview source); under react-native-web a Blob is wrapped
//     with the real `URL.createObjectURL` when present. Revocation only targets
//     `blob:` object URLs (native file/content/http uris are not owned object
//     URLs and are left intact). The set-on-start / clear-on-success-or-error /
//     revoke-on-unmount lifecycle is preserved byte-for-byte.
//   - `<img>` preview (L177-183) -> the RN `Image` (source={{uri}},
//     resizeMode="cover"); the `data-testid` becomes `testID` and the alt text
//     becomes `accessibilityLabel`.
//
// DOM -> native: every `<div>` -> `View`, `<h3>`/`<p>` -> `AppText`,
// `data-testid` -> `testID`. Tailwind -> StyleSheet (1 unit = 4px): p-4 -> 16,
// p-6 -> 24, gap-2 -> 8, gap-3 -> 12, space-y-4 -> gap 16, rounded-lg -> 8,
// rounded-xl -> 12, border-2 -> 2, max-h-48 -> 192; text-base -> 16,
// text-sm -> 14, text-xs -> 12. `--text-primary` -> colors.textPrimary,
// `--text-secondary` -> colors.textSecondary, `--text-muted` -> colors.textMuted,
// `--border-subtle` -> colors.border, `--surface-2` -> colors.surfaceRaised; the
// cyan active state (border-cyan-400 bg-cyan-500/10) -> colors.accent +
// colors.accentSoft. No DOM-only modules, browser HTML elements, Recharts,
// Leaflet, or old web UI components are imported.

import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {
  useDeleteVehiclePhoto,
  useUploadVehiclePhoto,
  useVehiclePhoto,
  validateVehiclePhotoFile,
  vehiclePhotoUrl,
  VEHICLE_PHOTO_ALLOWED_MIME,
  VEHICLE_PHOTO_MAX_BYTES,
  type NativeVehiclePhotoFile,
  type VehiclePhotoUploadFile,
} from '../../../api/hooks/useVehiclePhoto';

// ─── i18n fallback shim (web react-i18next useTranslation) ────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the key, so intent survives. The
// optional vars map reproduces the web `{{name}}` interpolation.
type TFunc = (
  key: string,
  fallback: string,
  vars?: Record<string, string | number>,
) => string;

function useTranslation(): {t: TFunc} {
  return {
    t: (_key, fallback, vars) =>
      vars
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name) =>
            name in vars ? String(vars[name]) : `{{${name}}}`,
          )
        : fallback,
  };
}

// Web: const ACCEPT_ATTR = Array.from(VEHICLE_PHOTO_ALLOWED_MIME).join(',') — the
// accept attribute of the hidden <input type=file>. Kept verbatim and forwarded
// to the host-injected picker as the accepted-mime filter.
const ACCEPT_ATTR = Array.from(VEHICLE_PHOTO_ALLOWED_MIME).join(',');

// ─── Object-URL preview lifecycle (web URL.createObjectURL/revoke) ──
function isNativeVehiclePhotoFile(
  file: VehiclePhotoUploadFile,
): file is NativeVehiclePhotoFile {
  return (
    typeof file === 'object' &&
    file !== null &&
    'uri' in file &&
    typeof (file as NativeVehiclePhotoFile).uri === 'string'
  );
}

// A picked native file is already addressable by its `uri`, so the descriptor's
// uri is the preview source. Under react-native-web a Blob is wrapped with the
// real URL.createObjectURL when it exists, mirroring the web lifecycle.
function createPreviewUrl(file: VehiclePhotoUploadFile): string | null {
  if (isNativeVehiclePhotoFile(file)) {
    return file.uri;
  }
  const urlApi = (
    globalThis as typeof globalThis & {URL?: {createObjectURL?: unknown}}
  ).URL;
  const create = urlApi?.createObjectURL;
  if (typeof create === 'function') {
    return (create as (blob: Blob) => string)(file as Blob);
  }
  return null;
}

// Only blob: object URLs need revoking; native file/content/http uris are not
// owned object URLs, so they are left intact.
function revokePreviewUrl(url: string): void {
  if (!url.startsWith('blob:')) {
    return;
  }
  const urlApi = (
    globalThis as typeof globalThis & {URL?: {revokeObjectURL?: unknown}}
  ).URL;
  const revoke = urlApi?.revokeObjectURL;
  if (typeof revoke === 'function') {
    (revoke as (value: string) => void)(url);
  }
}

// ─── Interactive picker resolution (web hidden <input type=file>) ──
// True native has no DOM file input and apps/native ships no image-picker
// dependency, so interactive photo selection is unavailable unless a host
// injects a picker on the global. Resolved at call-time (PrintButton precedent).
type NativePhotoPicker = (
  accept: string,
) => Promise<VehiclePhotoUploadFile | null>;

function resolvePhotoPicker(): NativePhotoPicker | null {
  const picker = (
    globalThis as typeof globalThis & {__teslasyncPickVehiclePhoto?: unknown}
  ).__teslasyncPickVehiclePhoto;
  return typeof picker === 'function'
    ? (picker as NativePhotoPicker)
    : null;
}

/**
 * Static platform truths for callers/tests. Interactive selection requires a
 * host-injected picker; drag-and-drop has no React Native analog.
 */
export const vehiclePhotoUploadCapabilities = {
  bundledPickerAvailable: false,
  dragAndDropAvailable: false,
} as const;

// ─── useToast (web @/components/feedback/Toast useToast) ───────────
// Lightweight in-panel banner host preserving the single-arg success(title) /
// error(message) contract; auto-dismisses after a few seconds.
interface ActiveToast {
  id: number;
  type: 'success' | 'error';
  title: string;
}

function useToast() {
  const [active, setActive] = useState<ActiveToast | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = React.useRef(0);

  const show = useCallback((next: ActiveToast) => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    setActive(next);
    timer.current = setTimeout(
      () => setActive(null),
      next.type === 'error' ? 6000 : 4000,
    );
  }, []);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const success = useCallback(
    (title: string) => {
      seq.current += 1;
      show({id: seq.current, type: 'success', title});
    },
    [show],
  );

  const error = useCallback(
    (title: string) => {
      seq.current += 1;
      show({id: seq.current, type: 'error', title});
    },
    [show],
  );

  const node = active ? (
    <View pointerEvents="none" style={styles.toastWrap}>
      <View
        accessibilityRole={active.type === 'error' ? 'alert' : 'text'}
        style={[
          styles.toast,
          active.type === 'error' ? styles.toastError : styles.toastSuccess,
        ]}>
        <AppText style={styles.toastText} weight="semibold">
          {active.title}
        </AppText>
      </View>
    </View>
  ) : null;

  return {success, error, node};
}

// ─── ActionButton (web @/components/ui/Button variant + size=sm) ──
function ActionButton({
  disabled = false,
  label,
  onPress,
  testID,
  variant,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  testID: string;
  variant: 'primary' | 'ghost';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'primary' ? styles.buttonPrimary : styles.buttonGhost,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
      testID={testID}>
      <AppText
        style={[
          styles.buttonText,
          variant === 'primary'
            ? styles.buttonPrimaryText
            : styles.buttonGhostText,
        ]}
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// ─── ConfirmDialog (web @/components/ui/ConfirmDialog, used props only) ──
function ConfirmDialog({
  confirmLabel,
  loading = false,
  message,
  onCancel,
  onConfirm,
  open,
  title,
  variant = 'danger',
}: {
  confirmLabel: string;
  loading?: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
  variant?: 'danger' | 'warning';
}) {
  const handleCancel = loading ? undefined : onCancel;

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleCancel}
      transparent
      visible={open}>
      <View
        accessibilityLabel={title}
        accessibilityRole="alert"
        accessible
        style={styles.dialogOverlay}>
        <Pressable
          accessibilityElementsHidden
          disabled={loading}
          importantForAccessibility="no-hide-descendants"
          onPress={handleCancel}
          style={styles.dialogBackdrop}
        />
        <View style={styles.dialog}>
          <AppText style={styles.dialogTitle} variant="title" weight="bold">
            {title}
          </AppText>
          <View
            style={[
              styles.dialogMessageBox,
              variant === 'danger'
                ? styles.dialogMessageDanger
                : styles.dialogMessageWarning,
            ]}>
            <AppText style={styles.dialogMessage}>{message}</AppText>
          </View>
          <View style={styles.dialogActions}>
            <Pressable
              accessibilityLabel="Cancel"
              accessibilityRole="button"
              disabled={loading}
              onPress={onCancel}
              style={({pressed}) => [
                styles.dialogButton,
                styles.dialogCancel,
                loading && styles.buttonDisabled,
                pressed && !loading && styles.buttonPressed,
              ]}>
              <AppText style={styles.dialogCancelText} weight="semibold">
                Cancel
              </AppText>
            </Pressable>
            <Pressable
              accessibilityLabel={confirmLabel}
              accessibilityRole="button"
              accessibilityState={{busy: loading, disabled: loading}}
              disabled={loading}
              onPress={onConfirm}
              style={({pressed}) => [
                styles.dialogButton,
                variant === 'danger'
                  ? styles.dialogConfirmDanger
                  : styles.dialogConfirmWarning,
                loading && styles.buttonDisabled,
                pressed && !loading && styles.buttonPressed,
              ]}>
              {loading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <AppText style={styles.dialogConfirmText} weight="semibold">
                  {confirmLabel}
                </AppText>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export interface VehiclePhotoUploadProps {
  vehicleId: number;
  // Web Tailwind className has no React Native analog; retained for source
  // compatibility and ignored. Use `style` to override the root GlassPanel.
  className?: string;
  style?: StyleProp<ViewStyle>;
}

export function VehiclePhotoUpload({
  vehicleId,
  className: _className,
  style,
}: VehiclePhotoUploadProps) {
  const {t} = useTranslation();
  const toast = useToast();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Drag-and-drop is browser-only; with no native drag events this stays false
  // and the dropzone renders its idle border.
  const [dragActive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const meta = useVehiclePhoto(vehicleId);
  const upload = useUploadVehiclePhoto();
  const remove = useDeleteVehiclePhoto();

  // Free the preview Object URL when the component unmounts or when a new
  // preview replaces the prior one. createObjectURL leaks the underlying file
  // until revoked.
  useEffect(() => {
    return () => {
      if (previewUrl) {
        revokePreviewUrl(previewUrl);
      }
    };
  }, [previewUrl]);

  const startUpload = useCallback(
    (file: VehiclePhotoUploadFile) => {
      const validation = validateVehiclePhotoFile(file);
      if (validation) {
        toast.error(validation.message);
        return;
      }
      // Build a preview for instant feedback while the upload runs.
      const url = createPreviewUrl(file);
      setPreviewUrl(prev => {
        if (prev) {
          revokePreviewUrl(prev);
        }
        return url;
      });
      upload.mutate(
        {vehicleId, file},
        {
          onSuccess: () => {
            toast.success(t('vehicles.photos.uploadSuccess', 'Photo uploaded.'));
            setPreviewUrl(prev => {
              if (prev) {
                revokePreviewUrl(prev);
              }
              return null;
            });
          },
          onError: err => {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(
              message || t('vehicles.photos.uploadFailed', 'Photo upload failed.'),
            );
            setPreviewUrl(prev => {
              if (prev) {
                revokePreviewUrl(prev);
              }
              return null;
            });
          },
        },
      );
    },
    [upload, vehicleId, toast, t],
  );

  // Web handleFileChange read e.target.files?.[0] from the <input type=file>
  // change and reset the input so the same file could be re-picked. On native a
  // host-injected picker returns the file (or null when cancelled) directly;
  // re-picking is inherent (each invocation is a fresh picker call). When no
  // picker is registered, surface the explicit unavailable state.
  const handleChoose = useCallback(async () => {
    const picker = resolvePhotoPicker();
    if (!picker) {
      toast.error(
        t(
          'vehicles.photos.upload.unavailable',
          'Choosing a photo is not available on this device.',
        ),
      );
      return;
    }
    const file = await picker(ACCEPT_ATTR);
    if (file) {
      startUpload(file);
    }
  }, [startUpload, toast, t]);

  const handleRemove = useCallback(() => {
    remove.mutate(vehicleId, {
      onSuccess: () => {
        toast.success(t('vehicles.photos.deleteSuccess', 'Photo removed.'));
        setConfirmDelete(false);
      },
      onError: err => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(
          message || t('vehicles.photos.deleteFailed', 'Failed to remove photo.'),
        );
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
    <GlassPanel style={[styles.panel, style]}>
      <View style={styles.headerRow}>
        <AppText
          accessibilityRole="header"
          style={styles.title}
          weight="semibold">
          {t('vehicles.photos.upload.title', 'Vehicle photo')}
        </AppText>
        {meta.isLoading ? (
          <ActivityIndicator color={colors.accent} size="small" />
        ) : null}
      </View>

      <View
        style={[
          styles.dropzone,
          dragActive ? styles.dropzoneActive : styles.dropzoneIdle,
        ]}
        testID="vehicle-photo-dropzone">
        {currentUrl ? (
          <Image
            accessibilityIgnoresInvertColors
            accessibilityLabel={t(
              'vehicles.photos.upload.previewAlt',
              'Vehicle photo preview',
            )}
            resizeMode="cover"
            source={{uri: currentUrl}}
            style={styles.preview}
            testID="vehicle-photo-preview"
          />
        ) : (
          <AppText style={styles.dropPrompt} tone="secondary">
            {t(
              'vehicles.photos.upload.dropPrompt',
              'Drag a photo here or click to choose a file',
            )}
          </AppText>
        )}

        <AppText style={styles.constraints} tone="muted" variant="caption">
          {t('vehicles.photos.upload.constraints', 'JPEG or PNG — up to {{max}} MB', {
            max: maxMB,
          })}
        </AppText>

        <View style={styles.actions}>
          <ActionButton
            disabled={isUploading}
            label={
              isUploading
                ? t('vehicles.photos.upload.uploading', 'Uploading…')
                : hasPhoto
                  ? t('vehicles.photos.upload.replace', 'Replace photo')
                  : t('vehicles.photos.upload.choose', 'Choose photo')
            }
            onPress={handleChoose}
            testID="vehicle-photo-choose"
            variant="primary"
          />
          {hasPhoto ? (
            <ActionButton
              disabled={isUploading || remove.isPending}
              label={t('vehicles.photos.upload.remove', 'Remove photo')}
              onPress={() => setConfirmDelete(true)}
              testID="vehicle-photo-remove"
              variant="ghost"
            />
          ) : null}
        </View>
      </View>

      <ConfirmDialog
        confirmLabel={t('common.remove', 'Remove')}
        loading={remove.isPending}
        message={t(
          'vehicles.photos.upload.confirmRemoveMessage',
          'The hero card will fall back to the stock model render until a new photo is uploaded.',
        )}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleRemove}
        open={confirmDelete}
        title={t('vehicles.photos.upload.confirmRemoveTitle', 'Remove vehicle photo?')}
        variant="danger"
      />

      {toast.node}
    </GlassPanel>
  );
}

VehiclePhotoUpload.displayName = 'VehiclePhotoUpload';

export default VehiclePhotoUpload;

const styles = StyleSheet.create({
  panel: {
    gap: 16, // space-y-4
    padding: 16, // p-4
  },
  headerRow: {
    alignItems: 'center', // items-center
    flexDirection: 'row', // flex
    justifyContent: 'space-between', // justify-between
  },
  title: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 16, // text-base
  },
  dropzone: {
    alignItems: 'center', // items-center
    borderRadius: 12, // rounded-xl
    borderStyle: 'dashed', // border-dashed
    borderWidth: 2, // border-2
    gap: 12, // gap-3
    justifyContent: 'center', // justify-center
    padding: 24, // p-6
  },
  dropzoneActive: {
    backgroundColor: colors.accentSoft, // bg-cyan-500/10
    borderColor: colors.accent, // border-cyan-400
  },
  dropzoneIdle: {
    backgroundColor: colors.surfaceRaised, // bg-[var(--surface-2)]
    borderColor: colors.border, // border-[var(--border-subtle)]
  },
  preview: {
    borderRadius: 8, // rounded-lg
    height: 192, // max-h-48
    width: '100%',
  },
  dropPrompt: {
    fontSize: 14, // text-sm
    textAlign: 'center',
  },
  constraints: {
    fontSize: 12, // text-xs
    textAlign: 'center',
  },
  actions: {
    alignItems: 'center', // items-center
    flexDirection: 'row', // flex
    flexWrap: 'wrap', // flex-wrap
    gap: 8, // gap-2
    justifyContent: 'center', // justify-center
  },
  // ── ActionButton (Button size=sm: h-8 px-3 text-xs) ──
  button: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonText: {
    fontSize: 13,
    lineHeight: 16,
  },
  buttonPrimaryText: {
    color: colors.background,
  },
  buttonGhostText: {
    color: colors.textSecondary,
  },
  // ── Toast banner host ──
  toastWrap: {
    alignItems: 'center',
  },
  toast: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    width: '100%',
  },
  toastSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  toastError: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  toastText: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  // ── ConfirmDialog ──
  dialogOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  dialogBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.lg,
    margin: spacing.lg,
    maxWidth: 480,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  dialogMessageBox: {
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.md,
  },
  dialogMessageDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  dialogMessageWarning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  dialogMessage: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  dialogActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  dialogButton: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
  },
  dialogCancel: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
  dialogCancelText: {
    color: colors.textPrimary,
  },
  dialogConfirmDanger: {
    backgroundColor: '#dc2626',
  },
  dialogConfirmWarning: {
    backgroundColor: '#f59e0b',
  },
  dialogConfirmText: {
    color: '#ffffff',
  },
});
