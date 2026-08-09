/**
 * GeofencesPage — modern-ui full-width redesign.
 *
 * Full-bleed responsive bento: a KPI band, an (AI-gated) Helix draft
 * assistant, and a hero "Zones" panel whose geofence cards flow into an
 * auto-fit grid that fills every column on wide monitors. Each data
 * section owns its loading / empty / error state; a modal handles
 * create/edit with vehicle / browser / map-drawn location capture.
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  MapPin, Plus, Pencil, Trash2, Globe, Ruler, Shield,
  LogIn, LogOut, Check, X, Activity, Navigation, RefreshCw,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Badge, Button, Input, Select, Modal, Toggle, ConfirmDialog,
  Tabs, PinButton, EditableText, Checkbox, PanelTitle, Caption, Label,
  Text, HelperText,
} from '@/components/ui';
import { MetricCard, BulkActionToolbar } from '@/components/data-display';
import { Skeleton, EmptyState, Spinner, AlertBanner, QueryError } from '@/components/feedback';
import { useToast } from '@/components/feedback/Toast';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { SearchInput, FilterBar, ActiveFilterChips, type FilterChipDescriptor } from '@/components/forms';
import { useFilteredList } from '@/hooks/useFilteredList';
import { useDirtyForm } from '@/hooks/useDirtyForm';
import { useConfirm } from '@/hooks/useConfirm';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { useAiEnabled } from '@/hooks/useAiEnabled';
import { useBulkGeofencesDelete } from '@/api/hooks/useLocations';
import {
  MapContainer,
  MapTileLayer,
  MapInvalidator,
  GeofenceDrawer,
  type DrawableGeofence,
  type NewGeofence,
} from '@/components/maps';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePinned } from '@/api/hooks/usePinned';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';
import type { Geofence } from '@/types/location';
import type { Position } from '@/api/types';
import { AISuggestNewGeofences } from '@/components/ai/AISuggestNewGeofences';
import { ChargingPlacesWorkspace } from '@/features/maps/components/charging-places';
import {
  geofenceFormSchema,
  toGeofencePayload,
  type GeofenceFormData,
  type GeofenceAlertType,
} from '../schemas/geofence';

// ─── Types ───────────────────────────────────────────────────────────────────

type AlertType = GeofenceAlertType;
type LocationSource = 'vehicle' | 'browser' | 'map';

interface ReverseGeocodeResult {
  display_name: string;
  road: string;
  city: string;
  state: string;
  country: string;
  postcode: string;
}

const EMPTY_FORM: GeofenceFormData = {
  name: '',
  latitude: '',
  longitude: '',
  radius: '100',
  alertType: 'both',
  enabled: true,
};

const ALERT_OPTIONS = [
  { value: 'entry', label: 'Entry Only' },
  { value: 'exit', label: 'Exit Only' },
  { value: 'both', label: 'Entry & Exit' },
  { value: 'none', label: 'None' },
];

// Auto-fit bento: cards flow and fill every available column on wide
// monitors, collapsing to a single column on phones — the strongest
// "use the whole screen on any monitor" tool per the design language.
const CARD_GRID = 'grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAlertType(g: Geofence): AlertType {
  if (g.alertOnEntry && g.alertOnExit) return 'both';
  if (g.alertOnEntry) return 'entry';
  if (g.alertOnExit) return 'exit';
  return 'none';
}

function alertBadgeVariant(type: AlertType): 'success' | 'warning' | 'info' | 'neutral' {
  switch (type) {
    case 'both': return 'success';
    case 'entry': return 'info';
    case 'exit': return 'warning';
    default: return 'neutral';
  }
}

function alertBadgeLabel(type: AlertType, t: (k: string) => string): string {
  switch (type) {
    case 'both': return t('Entry & Exit');
    case 'entry': return t('Entry');
    case 'exit': return t('Exit');
    default: return t('None');
  }
}

/**
 * Robustly detect a W3C Geolocation error.
 *
 * `getCurrentPosition`'s error callback yields a `GeolocationPositionError`
 * (numeric `code`: 1=denied, 2=unavailable, 3=timeout). We cannot rely on the
 * `GeolocationPositionError` constructor existing as a runtime global — it is
 * absent in insecure contexts, some test environments (jsdom), and older
 * browsers that only exposed the legacy `PositionError` name — so a bare
 * `instanceof` inside the catch block would itself throw. Prefer the
 * constructor when present, then fall back to duck-typing the numeric `code`.
 */
function isGeolocationError(err: unknown): boolean {
  if (
    typeof GeolocationPositionError !== 'undefined' &&
    err instanceof GeolocationPositionError
  ) {
    return true;
  }
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'number'
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function GeofencesPage() {
  const { t } = useTranslation();
  usePageTitle(t('Geofences'));
  const queryClient = useQueryClient();
  const toast = useToast();

  // The Helix draft assistant is an AI surface — gate the whole section
  // (input + card) on the feature flag so nothing leaks into the DOM in
  // ai_mode='off' (ADR-015). withAiFeature already null-guards the card;
  // gating here also hides the location picker that feeds it.
  const aiEnabled = useAiEnabled('suggest-new-geofences');

  // ─── State ───────────────────────────────────────────────────────────────

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GeofenceFormData>(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState<GeofenceFormData>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof GeofenceFormData, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Geofence | null>(null);
  const [locationSource, setLocationSource] = useState<LocationSource>('vehicle');
  const [selectedVehicleId, setSelectedVehicleId] = useState<number>(0);
  const [locationLoading, setLocationLoading] = useState(false);
  const [search, setSearch] = useState('');
  // The AI geofence suggestion panel needs a candidate visited-location ID.
  // We expose
  // a small numeric input so the user can paste the ID copied from
  // the Locations page; future work may auto-populate this from
  // a clustering job. The state is local to this page so the off-
  // mode user never sees it (the AI panel itself is gated by
  // withAiFeature).
  const [aiLocationIdRaw, setAiLocationIdRaw] = useState('');
  const aiLocationId = useMemo(() => {
    const parsed = parseInt(aiLocationIdRaw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [aiLocationIdRaw]);

  // Bulk selection keys off geofence ids and clears when the filtered list
  // changes so users don't carry stale selections.
  // The frontend Geofence type carries id as string (legacy) but the
  // backend bulk endpoint expects int64s — we convert at the call site.
  const sel = useBulkSelection<string>();
  const bulkDelete = useBulkGeofencesDelete();

  // Dirty when the modal is open AND the form diverges from the initial
  // snapshot taken on open. Closed modal => not dirty so we don't pester the
  // user about list-page navigation.
  const isFormDirty = useMemo(() => {
    if (!modalOpen) return false;
    return (
      form.name !== initialForm.name ||
      form.latitude !== initialForm.latitude ||
      form.longitude !== initialForm.longitude ||
      form.radius !== initialForm.radius ||
      form.alertType !== initialForm.alertType ||
      form.enabled !== initialForm.enabled
    );
  }, [modalOpen, form, initialForm]);

  const dirtyForm = useDirtyForm(isFormDirty);
  const { confirm: confirmDiscard, dialogProps: discardDialogProps } = useConfirm();

  // ─── Data fetching ───────────────────────────────────────────────────────

  const geofencesQuery = useQuery({
    queryKey: ['geofences'],
    queryFn: ({ signal }) => request<Geofence[]>('/geofences', { signal }),
  });
  const geofences = geofencesQuery.data;
  const isLoading = geofencesQuery.isLoading;
  const error = geofencesQuery.error as Error | null;

  const { data: vehicles } = useVehicles();

  const createMut = useMutation({
    // origin/needsReview are server-managed (defaulted on create, untouched
    // on update) — the write form never submits them; only the fields the
    // backend's geofenceCreateRequest actually declares belong here.
    mutationFn: (body: Omit<Geofence, 'id' | 'createdAt' | 'origin' | 'needsReview'>) =>
      request<Geofence>('/geofences', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      toast.success(t('Geofence created'));
      closeModal();
    },
    onError: (err: Error) => toast.error(t('Failed to create geofence'), err.message),
  });

  const updateMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Omit<Geofence, 'id' | 'createdAt' | 'origin' | 'needsReview'>;
    }) => request<Geofence>(`/geofences/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      toast.success(t('Geofence updated'));
      closeModal();
    },
    onError: (err: Error) => toast.error(t('Failed to update geofence'), err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      request<void>(`/geofences/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      toast.success(t('Geofence deleted'));
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(t('Failed to delete geofence'), err.message),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      request<Geofence>(`/geofences/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['geofences'] }),
    onError: (err: Error) => toast.error(t('Failed to toggle geofence'), err.message),
  });

  // Inline rename sends a full merged payload rather than a partial `{ name }`
  // so the backend's PUT semantics
  // are unambiguous regardless of whether it does field-level merge.
  // Errors are surfaced inline by EditableText, so no toast here.
  const renameMut = useMutation({
    mutationFn: ({ g, name }: { g: Geofence; name: string }) => {
      const { id: _id, createdAt: _createdAt, ...rest } = g;
      void _id;
      void _createdAt;
      return request<Geofence>(`/geofences/${g.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...rest, name }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['geofences'] }),
  });

  // ─── Computed stats ──────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const list = geofences ?? [];
    return {
      total: list.length,
      active: list.filter((g) => g.enabled).length,
      entryAlerts: list.filter((g) => g.alertOnEntry).length,
      exitAlerts: list.filter((g) => g.alertOnExit).length,
    };
  }, [geofences]);

  const geofenceSearchFields = useMemo(
    () => ['name'] as const satisfies ReadonlyArray<keyof Geofence>,
    [],
  );
  const filteredGeofences = useFilteredList(geofences, search, geofenceSearchFields);
  const { data: geofencePins = [] } = usePinned('geofence');
  const sortedGeofences = useMemo(() => {
    if (geofencePins.length === 0) return filteredGeofences;
    const order = new Map<string, number>();
    geofencePins.forEach((p) => order.set(String(p.item_id), p.position));
    return [...filteredGeofences].sort((a, b) => {
      const ap = order.get(String(a.id));
      const bp = order.get(String(b.id));
      if (ap != null && bp != null) return ap - bp;
      if (ap != null) return -1;
      if (bp != null) return 1;
      return 0;
    });
  }, [filteredGeofences, geofencePins]);

  const list = geofences ?? [];
  const hasGeofences = list.length > 0;

  // ─── Drawer integration ──────────────────────────────────────────────────

  /* Center the picker map on the form's current coords or fall back to
     the first existing geofence so users have spatial context. */
  const mapPickerCenter = useMemo<[number, number]>(() => {
    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);
    if (!Number.isNaN(lat) && !Number.isNaN(lng) && (lat !== 0 || lng !== 0)) {
      return [lat, lng];
    }
    const first = (geofences ?? [])[0];
    if (first && first.latitude != null && first.longitude != null) {
      return [first.latitude, first.longitude];
    }
    return [37.7749, -122.4194];
  }, [form.latitude, form.longitude, geofences]);

  const mapPickerZoom = useMemo(() => {
    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);
    return !Number.isNaN(lat) && !Number.isNaN(lng) && (lat !== 0 || lng !== 0) ? 15 : 11;
  }, [form.latitude, form.longitude]);

  /* Render the in-progress drawing as a draftable fence so editing works. */
  const drawerFences = useMemo<DrawableGeofence[]>(() => {
    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);
    const radius = parseFloat(form.radius);
    if (
      Number.isNaN(lat) ||
      Number.isNaN(lng) ||
      Number.isNaN(radius) ||
      (lat === 0 && lng === 0)
    ) {
      return [];
    }
    return [{ id: 'draft', lat, lng, radius, name: form.name || undefined }];
  }, [form.latitude, form.longitude, form.radius, form.name]);

  const handleDrawerCreate = useCallback((g: NewGeofence) => {
    if (g.shape !== 'circle' || g.lat == null || g.lng == null || g.radius == null) {
      return;
    }
    setForm((prev) => ({
      ...prev,
      latitude: String(g.lat),
      longitude: String(g.lng),
      radius: String(Math.round(g.radius ?? 0)),
    }));
  }, []);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setInitialForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
  }, []);

  /**
   * Cancel handler — if the user has made unsaved edits, prompt before
   * dismissing the modal. Otherwise close immediately.
   */
  const handleRequestClose = useCallback(async () => {
    if (isFormDirty) {
      const ok = await confirmDiscard({
        title: dirtyForm.title,
        message: dirtyForm.message,
        variant: 'warning',
        confirmLabel: dirtyForm.discardLabel,
        cancelLabel: dirtyForm.keepEditingLabel,
        silenceKey: 'discard-draft',
      });
      if (!ok) return;
    }
    closeModal();
  }, [
    isFormDirty,
    confirmDiscard,
    dirtyForm.title,
    dirtyForm.message,
    dirtyForm.discardLabel,
    dirtyForm.keepEditingLabel,
    closeModal,
  ]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setInitialForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    setLocationLoading(false);
    setModalOpen(true);
  }, []);

  // Apply-from-AI opens the canonical Add Geofence modal pre-filled
  // with the typed envelope fields the LLM proposed (name +
  // centroid lat/lon + radius). The user reviews the pre-filled
  // form and clicks Save in the existing baseline modal — the AI
  // panel never persists state itself (ADR-015 §I3 + §I8).
  const applyAiDraftToForm = useCallback(
    (draft: { name: string; latitude: number; longitude: number; radius: number }) => {
      const next: GeofenceFormData = {
        name: draft.name,
        latitude: String(draft.latitude),
        longitude: String(draft.longitude),
        radius: String(Math.round(draft.radius)),
        alertType: EMPTY_FORM.alertType,
        enabled: EMPTY_FORM.enabled,
      };
      setEditingId(null);
      setForm(next);
      setInitialForm(EMPTY_FORM);
      setFieldErrors({});
      setFormError(null);
      setLocationLoading(false);
      setModalOpen(true);
    },
    [],
  );

  const openEdit = useCallback((g: Geofence) => {
    setEditingId(g.id);
    const next: GeofenceFormData = {
      name: g.name,
      latitude: String(g.latitude),
      longitude: String(g.longitude),
      radius: String(g.radius),
      alertType: getAlertType(g),
      enabled: g.enabled,
    };
    setForm(next);
    setInitialForm(next);
    setFieldErrors({});
    setFormError(null);
    setModalOpen(true);
  }, []);

  const reverseGeocode = useCallback(async (lat: number, lon: number): Promise<string> => {
    try {
      const res = await request<ReverseGeocodeResult>(`/geocode/reverse?lat=${lat}&lon=${lon}`);
      return res.display_name || `${fmtNumber(lat, 4)}, ${fmtNumber(lon, 4)}`;
    } catch {
      return `${fmtNumber(lat, 4)}, ${fmtNumber(lon, 4)}`;
    }
  }, []);

  const handleGetLocation = useCallback(async () => {
    setLocationLoading(true);
    try {
      let lat: number;
      let lon: number;

      if (locationSource === 'vehicle') {
        if (selectedVehicleId <= 0) {
          toast.error(t('geofences.selectVehicle', 'Select a vehicle first'));
          setLocationLoading(false);
          return;
        }
        const positions = await request<Position[]>(
          `/vehicles/${selectedVehicleId}/positions?limit=1`,
        );
        if (!positions || positions.length === 0) {
          toast.error(t('geofences.noPosition', 'No position data available for this vehicle'));
          setLocationLoading(false);
          return;
        }
        lat = positions[0].latitude;
        lon = positions[0].longitude;
      } else {
        // Browser geolocation — guard against environments (insecure
        // contexts, unsupported browsers) where the API is absent so the user
        // sees a friendly message instead of a raw TypeError.
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          toast.error(
            t('geofences.geolocationUnsupported', 'Geolocation is not supported by this browser'),
          );
          setLocationLoading(false);
          return;
        }
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          });
        });
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
      }

      const name = await reverseGeocode(lat, lon);
      setForm((prev) => ({
        ...prev,
        name: prev.name || name,
        latitude: String(lat),
        longitude: String(lon),
      }));
    } catch (err) {
      const message = isGeolocationError(err)
        ? t('geofences.locationDenied', 'Location access denied')
        : err instanceof Error
          ? err.message
          : t('geofences.locationFailed', 'Failed to get location');
      toast.error(message);
    } finally {
      setLocationLoading(false);
    }
  }, [locationSource, selectedVehicleId, reverseGeocode, toast, t]);

  const handleSubmit = useCallback(() => {
    setFormError(null);
    const parsed = geofenceFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof GeofenceFormData, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof GeofenceFormData | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setFieldErrors(next);
      setFormError(t('forms.validationFailed', 'Please fix the highlighted fields before saving.'));
      return;
    }
    setFieldErrors({});
    const payload = toGeofencePayload(parsed.data);
    if (editingId) {
      updateMut.mutate({ id: editingId, body: payload });
    } else {
      createMut.mutate(payload);
    }
  }, [form, editingId, createMut, updateMut, t]);

  // Submit-disable heuristic: avoid disabling the button on type errors
  // alone — let the zod parse drive the actual error display. Just block
  // when any required string is empty so the button feels responsive.
  const hasMinimalInput =
    form.name.trim().length > 0 &&
    form.latitude.trim().length > 0 &&
    form.longitude.trim().length > 0 &&
    form.radius.trim().length > 0;

  const isSaving = createMut.isPending || updateMut.isPending;

  const searchChips = (search
    ? [
        {
          key: 'q',
          label: t('geofences.filterLabel.search', 'Search'),
          value: search,
          onRemove: () => setSearch(''),
        } satisfies FilterChipDescriptor,
      ]
    : []) as readonly FilterChipDescriptor[];

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <PageContainer
      title={t('Geofences')}
      subtitle={t('Define locations for contextual tracking and automation')}
      query={geofencesQuery}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => geofencesQuery.refetch()}
            aria-label={t('common.refresh', 'Refresh')}
          >
            <RefreshCw
              className={cn('h-4 w-4', geofencesQuery.isFetching && 'animate-spin')}
              aria-hidden="true"
            />
          </Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={openCreate}>
            {t('Add Geofence')}
          </Button>
        </div>
      }
    >
      {/* 1 — KPI band: full-width responsive metric grid. Always visible with a
          0 placeholder so the section never disappears on empty/error. */}
      <FadeIn>
        <section
          aria-label={t('geofences.summaryAria', 'Geofence summary')}
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        >
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={84} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('Total Geofences')}
                value={stats.total ?? 0}
                icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
                color="purple"
              />
              <MetricCard
                label={t('Active')}
                value={stats.active ?? 0}
                icon={<Check className="h-4 w-4" aria-hidden="true" />}
                color="green"
              />
              <MetricCard
                label={t('Entry Alerts')}
                value={stats.entryAlerts ?? 0}
                icon={<LogIn className="h-4 w-4" aria-hidden="true" />}
                color="cyan"
              />
              <MetricCard
                label={t('Exit Alerts')}
                value={stats.exitAlerts ?? 0}
                icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
                color="amber"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Helix draft assistant. Whole section gated on the AI feature flag
          so no AI surface (input included) leaks into the DOM in off mode. */}
      {aiEnabled && (
        <FadeIn delay={0.1}>
          <section
            aria-label={t('geofences.aiSuggest.title', 'Suggest a geofence for this location')}
            className="grid grid-cols-1 gap-4 xl:grid-cols-3"
          >
            <GlassPanel className="space-y-3 p-4 sm:p-5">
              <PanelTitle className="flex items-center gap-2">
                <Navigation className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('geofences.aiSuggest.badge', 'Helix')}
              </PanelTitle>
              <Input
                type="number"
                min={1}
                value={aiLocationIdRaw}
                onChange={(e) => setAiLocationIdRaw(e.target.value)}
                label={t(
                  'geofences.aiSuggest.pickLocation',
                  'Pick a visited location to draft a geofence around',
                )}
                placeholder="501"
              />
              <Caption>
                {t(
                  'geofences.aiSuggest.pickHint',
                  'Paste a visited-location ID from the Locations page to draft a zone around it.',
                )}
              </Caption>
            </GlassPanel>
            <div className="xl:col-span-2">
              <AISuggestNewGeofences
                locationId={aiLocationId}
                onApplyDraft={applyAiDraftToForm}
              />
            </div>
          </section>
        </FadeIn>
      )}

      {/* 3 — Zones: hero panel. Toolbar + search live in the header; the cards
          flow into a full-width auto-fit bento. Loading / empty / error are
          handled independently inside the panel body. */}
      <FadeIn delay={0.2}>
        <section aria-label={t('geofences.zonesAria', 'Geofence zones')}>
          <GlassPanel className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <PanelTitle className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                  {t('geofences.zonesTitle', 'Zones')}
                </PanelTitle>
                <Caption>
                  {t('geofences.zonesCount', '{{count}} defined', { count: list.length })}
                </Caption>
              </div>
              {hasGeofences && (
                <FilterBar>
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder={t('geofences.searchPlaceholder', 'Search by name…')}
                    className="w-full sm:w-72"
                    historyScope="geofences"
                  />
                </FilterBar>
              )}
            </div>

            {hasGeofences && searchChips.length > 0 && (
              <ActiveFilterChips
                filters={searchChips}
                onClearAll={() => setSearch('')}
              />
            )}

            {hasGeofences && (
              <BulkActionToolbar
                selectedIds={Array.from(sel.selectedIds)}
                total={sortedGeofences.length}
                onClear={sel.clear}
                itemNoun={{
                  one: t('geofences.noun.one', 'geofence'),
                  other: t('geofences.noun.other', 'geofences'),
                }}
                actions={[
                  {
                    id: 'delete',
                    label: t('geofences.bulk.delete', 'Delete'),
                    variant: 'danger',
                    icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
                    confirm: {
                      title: t('geofences.bulk.deleteConfirm.title', 'Delete geofences?'),
                      description: t(
                        'geofences.bulk.deleteConfirm.body',
                        'Selected geofences will be removed permanently. Linked alert rules and automations will continue to reference their old IDs.',
                      ),
                      confirmLabel: t('common.delete', 'Delete'),
                    },
                    onClick: async (ids) => {
                      await bulkDelete.mutateAsync(ids.map((i) => Number(i)));
                      sel.clear();
                    },
                  },
                ]}
              />
            )}

            {isLoading ? (
              <div className={CARD_GRID}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <GlassPanel key={i} className="space-y-3 p-4">
                    <Skeleton height={22} width="60%" />
                    <Skeleton height={14} />
                    <Skeleton height={14} width="80%" />
                    <Skeleton height={32} />
                  </GlassPanel>
                ))}
              </div>
            ) : error ? (
              <QueryError
                error={geofencesQuery.error}
                onRetry={() => geofencesQuery.refetch()}
                resourceName={t('geofences.noun.one', 'geofence')}
              />
            ) : !hasGeofences ? (
              <EmptyState
                icon={<Shield className="h-12 w-12" aria-hidden="true" />}
                title={t('No geofences defined')}
                message={t('Add a geofence to track when your vehicle arrives or leaves a location.')}
                action={{ label: t('Add Geofence'), onClick: openCreate }}
                className="py-10"
              />
            ) : filteredGeofences.length === 0 ? (
              <EmptyState
                icon={<Activity className="h-8 w-8 opacity-20" aria-hidden="true" />}
                message={t('geofences.noMatches', 'No geofences match your search.')}
                action={{ label: t('Clear search'), onClick: () => setSearch('') }}
                className="py-8"
              />
            ) : (
              <StaggerContainer className={CARD_GRID}>
                {sortedGeofences.map((g) => {
                  const alertType = getAlertType(g);
                  return (
                    <StaggerItem key={g.id}>
                      <GlassPanel hover glow="purple" className="flex h-full flex-col gap-3 p-4">
                        {/* Header: select + icon + name + badges + pin */}
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={sel.isSelected(g.id)}
                            onChange={() => sel.toggle(g.id)}
                            className="mt-1"
                            aria-label={t('geofences.selectGeofence', 'Select geofence {{name}}', { name: g.name })}
                          />
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)]">
                            <MapPin className="h-5 w-5 text-[var(--text-muted)]" aria-hidden="true" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <EditableText
                              value={g.name}
                              variant="heading"
                              ariaLabel={t('editableText.rename.geofence', 'Rename geofence {{name}}', { name: g.name })}
                              maxLength={120}
                              validate={(next) =>
                                next.length > 120
                                  ? t('geofences.error.nameTooLong', 'Max 120 characters')
                                  : null
                              }
                              onSave={async (next) => {
                                await renameMut.mutateAsync({ g, name: next });
                              }}
                            />
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <Badge variant={g.enabled ? 'success' : 'neutral'} size="sm">
                                {g.enabled ? t('Active') : t('Inactive')}
                              </Badge>
                              <Badge variant={alertBadgeVariant(alertType)} size="sm">
                                {alertBadgeLabel(alertType, t)}
                              </Badge>
                            </div>
                          </div>
                          <PinButton itemType="geofence" itemId={g.id} size="sm" />
                        </div>

                        {/* Meta: coordinates + radius */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <Text as="span" size="xs" color="muted" mono className="flex items-center gap-1">
                            <Globe className="h-3 w-3" aria-hidden="true" />
                            {fmtNumber(g.latitude ?? 0, 6)}, {fmtNumber(g.longitude ?? 0, 6)}
                          </Text>
                          <Text as="span" size="xs" color="muted" className="flex items-center gap-1">
                            <Ruler className="h-3 w-3" aria-hidden="true" />
                            {fmtNumber(g.radius ?? 0)} {t('m')}
                          </Text>
                        </div>

                        {/* Footer: enable toggle + edit / delete actions */}
                        <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
                          <div className="flex items-center gap-2">
                            <Toggle
                              checked={g.enabled}
                              onChange={(checked) => toggleMut.mutate({ id: g.id, enabled: checked })}
                              size="sm"
                              aria-label={t('geofences.toggleGeofence', 'Toggle geofence {{name}}', { name: g.name })}
                            />
                            <Text as="span" variant="bodySm">
                              {g.enabled ? t('Active') : t('Inactive')}
                            </Text>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
                              onClick={() => openEdit(g)}
                              aria-label={t('geofences.editGeofence', 'Edit geofence {{name}}', { name: g.name })}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                              onClick={() => setDeleteTarget(g)}
                              aria-label={t('geofences.deleteGeofence', 'Delete geofence {{name}}', { name: g.name })}
                            />
                          </div>
                        </div>
                      </GlassPanel>
                    </StaggerItem>
                  );
                })}
              </StaggerContainer>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 4 — Charging Places: geofence-based charging-place pricing. A
          self-contained workspace (Needs Setup queue, places list with
          current rate, and per-place rate history/preview-apply/activity
          detail) — decomposed into features/maps/components/charging-places
          rather than adding more bulk to this file directly. */}
      <FadeIn delay={0.3}>
        <section aria-label={t('chargingPlaces.workspace.title', 'Charging Places')}>
          <ChargingPlacesWorkspace />
        </section>
      </FadeIn>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={handleRequestClose}
        title={editingId ? t('Edit Geofence') : t('Create Geofence')}
        size="md"
      >
        <div className="space-y-4">
          {formError && (
            <AlertBanner variant="danger">{formError}</AlertBanner>
          )}
          {/* Use Current Location */}
          {!editingId && (
            <GlassPanel className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <Navigation className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
                <Label>{t('geofences.useCurrentLocation', 'Use Current Location')}</Label>
              </div>

              <Tabs
                tabs={[
                  { key: 'vehicle', label: `🚗 ${t('geofences.vehicle', 'Vehicle')}` },
                  { key: 'browser', label: `📱 ${t('geofences.browser', 'Browser')}` },
                  { key: 'map', label: `🗺️ ${t('geofences.drawOnMap', 'Draw on map')}` },
                ]}
                activeTab={locationSource}
                onChange={(key) => setLocationSource(key as LocationSource)}
              />

              {locationSource === 'vehicle' && (
                <Select
                  label={t('geofences.selectVehicle', 'Select Vehicle')}
                  options={[
                    { value: '0', label: t('geofences.chooseVehicle', '— Choose vehicle —') },
                    ...(vehicles ?? []).map((v) => ({
                      value: String(v.id),
                      label: v.display_name || v.vin,
                    })),
                  ]}
                  value={String(selectedVehicleId)}
                  onChange={(e) => setSelectedVehicleId(Number(e.target.value))}
                />
              )}

              {locationSource === 'map' ? (
                <div className="space-y-2">
                  <HelperText>
                    {t(
                      'geofences.drawHint',
                      'Click the circle tool, then click and drag on the map to draw a fence.',
                    )}
                  </HelperText>
                  <div
                    className="h-64 w-full overflow-hidden rounded-lg border border-white/[0.08]"
                    role="application"
                    aria-label={t('geofences.drawerLabel', 'Geofence drawing map')}
                  >
                    <MapContainer
                      center={mapPickerCenter}
                      zoom={mapPickerZoom}
                      scrollWheelZoom
                      className="h-full w-full"
                    >
                      <MapTileLayer style="dark" />
                      <MapInvalidator />
                      <GeofenceDrawer
                        fences={drawerFences}
                        onCreate={handleDrawerCreate}
                        modes={['circle']}
                      />
                    </MapContainer>
                  </div>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={locationLoading ? <Spinner size="sm" /> : <Navigation className="h-4 w-4" aria-hidden="true" />}
                  onClick={handleGetLocation}
                  disabled={locationLoading || (locationSource === 'vehicle' && selectedVehicleId <= 0)}
                >
                  {locationLoading
                    ? t('geofences.gettingLocation', 'Getting location…')
                    : t('geofences.getLocation', 'Get Location')}
                </Button>
              )}
            </GlassPanel>
          )}
          <Input
            label={t('Name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('Home')}
            error={fieldErrors.name}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('Latitude')}
              type="number"
              step="any"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              placeholder="37.7749"
              icon={<Globe className="h-4 w-4" aria-hidden="true" />}
              error={fieldErrors.latitude}
            />
            <Input
              label={t('Longitude')}
              type="number"
              step="any"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
              placeholder="-122.4194"
              icon={<Globe className="h-4 w-4" aria-hidden="true" />}
              error={fieldErrors.longitude}
            />
          </div>

          <Input
            label={t('Radius (meters)')}
            type="number"
            value={form.radius}
            onChange={(e) => setForm({ ...form, radius: e.target.value })}
            placeholder="100"
            icon={<Ruler className="h-4 w-4" aria-hidden="true" />}
            hint={t('Minimum 10m, maximum 50000m')}
            error={fieldErrors.radius}
          />

          <Select
            label={t('Alert Type')}
            options={ALERT_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
            value={form.alertType}
            onChange={(e) =>
              setForm({ ...form, alertType: e.target.value as AlertType })
            }
            error={fieldErrors.alertType}
          />

          <Toggle
            label={t('Active')}
            checked={form.enabled}
            onChange={(checked) => setForm({ ...form, enabled: checked })}
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={handleRequestClose} icon={<X className="h-4 w-4" aria-hidden="true" />}>
              {t('Cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!hasMinimalInput || isSaving}
              loading={isSaving}
              icon={<Check className="h-4 w-4" aria-hidden="true" />}
            >
              {editingId ? t('Update') : t('Create')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Discard-changes confirm dialog (mounted alongside the modal). */}
      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('Delete Geofence')}
        message={t('Are you sure you want to delete "{{name}}"? This action cannot be undone.', {
          name: deleteTarget?.name ?? '',
        })}
        confirmLabel={t('Delete')}
        cancelLabel={t('Cancel')}
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) deleteMut.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageContainer>
  );
}
