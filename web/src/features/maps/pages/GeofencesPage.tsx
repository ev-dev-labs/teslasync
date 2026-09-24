/**
 * GeofencesPage — modern-ui full-width redesign.
 *
 * Full-bleed responsive workspace: a KPI band, an (AI-gated) Helix draft
 * assistant, and one directory for zone controls, charging rates, and
 * session history. Each data section owns its loading / empty / error
 * state; a modal handles create/edit with vehicle, browser, or map-drawn
 * location capture.
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  MapPin, Plus, Globe, Ruler,
  Check, X, Navigation, RefreshCw, BatteryCharging,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Button, Input, Select, Modal, Toggle, ConfirmDialog,
  Tabs, PanelTitle, Caption, Label, HelperText,
} from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, AlertBanner } from '@/components/feedback';
import { useToast } from '@/components/feedback/Toast';
import { FadeIn } from '@/components/motion';
import { useDirtyForm } from '@/hooks/useDirtyForm';
import { useConfirm } from '@/hooks/useConfirm';
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
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';
import type { Geofence } from '@/types/location';
import type { Geofence as ApiGeofence, Position, VisitedPlaceCandidate } from '@/api/types';
import { AISuggestNewGeofences } from '@/components/ai/AISuggestNewGeofences';
import { ChargingPlacesWorkspace } from '@/features/maps/components/charging-places';
import { useVisitedPlaceCandidates, resolveSavedPlaceName } from '@/api/hooks/useLocations';
import {
  GEOFENCE_CATEGORY_LABELS,
  GEOFENCE_CATEGORY_VALUES,
} from '../geofenceCategories';
import {
  geofenceFormSchema,
  toGeofencePayload,
  type GeofenceFormData,
  type GeofencePayload,
} from '../schemas/geofence';

// ─── Types ───────────────────────────────────────────────────────────────────

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
  category: 'custom',
};


// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  usePageTitle(t('geofences.title', 'Geofences'));
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
  const [deleteTarget, setDeleteTarget] = useState<ApiGeofence | null>(null);
  const [locationSource, setLocationSource] = useState<LocationSource>('vehicle');
  const [locationLoading, setLocationLoading] = useState(false);
  // The AI geofence suggestion panel needs a candidate visited-location ID.
  // We expose
  // a small numeric input so the user can paste the ID copied from
  // the Locations page; future work may auto-populate this from
  // a clustering job. The state is local to this page so the off-
  // mode user never sees it (the AI panel itself is gated by
  // withAiFeature).
  const [aiLocationIdRaw, setAiLocationIdRaw] = useState('');
  const [reviewCandidate, setReviewCandidate] = useState<VisitedPlaceCandidate | null>(null);
  const [chargingPlace, setChargingPlace] = useState(false);
  const candidateQuery = useVisitedPlaceCandidates();
  const aiLocationId = useMemo(() => {
    const parsed = parseInt(aiLocationIdRaw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [aiLocationIdRaw]);

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
      form.category !== initialForm.category ||
      (reviewCandidate !== null && chargingPlace !== (reviewCandidate.charge_count > 0))
    );
  }, [modalOpen, form, initialForm, reviewCandidate, chargingPlace]);

  const dirtyForm = useDirtyForm(isFormDirty);
  const { confirm: confirmDiscard, dialogProps: discardDialogProps } = useConfirm();

  // ─── Data fetching ───────────────────────────────────────────────────────

  const geofencesQuery = useQuery({
    queryKey: ['geofences'],
    queryFn: ({ signal }) => request<Geofence[]>('/geofences', { signal }),
  });
  const geofences = geofencesQuery.data;
  const isLoading = geofencesQuery.isLoading;

  const {
    vehicleId,
    vehicles,
    setVehicleId,
  } = useSelectedVehicle();
  const selectedVehicleId = vehicleId ?? 0;

  const createMut = useMutation({
    // origin/needsReview are server-managed (defaulted on create, untouched
    // on update) — the write form never submits them; only the fields the
    // backend's geofenceCreateRequest actually declares belong here.
    mutationFn: (body: GeofencePayload & { is_charging_location?: boolean }) =>
      request<Geofence>('/geofences', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      toast.success(t('geofences.toastCreated', 'Geofence created'));
      closeModal();
    },
    onError: (err: Error) => toast.error(t('geofences.toastCreateError', 'Failed to create geofence'), err.message),
  });

  const updateMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: GeofencePayload;
    }) => request<Geofence>(`/geofences/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      toast.success(t('geofences.toastUpdated', 'Geofence updated'));
      closeModal();
    },
    onError: (err: Error) => toast.error(t('geofences.toastUpdateError', 'Failed to update geofence'), err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      request<void>(`/geofences/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      toast.success(t('geofences.toastDeleted', 'Geofence deleted'));
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(t('geofences.toastDeleteError', 'Failed to delete geofence'), err.message),
  });

  // ─── Computed stats ──────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const list = geofences ?? [];
    return {
      total: list.length,
      reviewed: list.filter((g) => !g.needsReview).length,
      pending: list.filter((g) => g.needsReview).length,
    };
  }, [geofences]);

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
    setReviewCandidate(null);
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
    setReviewCandidate(null);
    setChargingPlace(false);
    setForm(EMPTY_FORM);
    setInitialForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    setLocationLoading(false);
    setModalOpen(true);
  }, []);

  const openCandidate = useCallback((candidate: VisitedPlaceCandidate) => {
    const next: GeofenceFormData = {
      ...EMPTY_FORM,
      name: candidate.name,
      latitude: String(candidate.latitude),
      longitude: String(candidate.longitude),
      radius: '75',
    };
    setReviewCandidate(candidate);
    setChargingPlace(candidate.charge_count > 0);
    setEditingId(null);
    setForm(next);
    setInitialForm(next);
    setFieldErrors({});
    setFormError(null);
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
        category: EMPTY_FORM.category,
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

  const openEdit = useCallback((g: ApiGeofence) => {
    setEditingId(String(g.id));
    setReviewCandidate(null);
    const next: GeofenceFormData = {
      name: g.name,
      latitude: String(g.latitude),
      longitude: String(g.longitude),
      radius: String(g.radius),
      category: g.category ?? 'custom',
    };
    setForm(next);
    setInitialForm(next);
    setFieldErrors({});
    setFormError(null);
    setModalOpen(true);
  }, []);

  const reverseGeocode = useCallback(async (lat: number, lon: number): Promise<string> => {
    const savedName = await resolveSavedPlaceName(lat, lon);
    if (savedName) return savedName;
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
      createMut.mutate({ ...payload, is_charging_location: chargingPlace });
    }
  }, [form, editingId, createMut, updateMut, t, chargingPlace]);

  // Submit-disable heuristic: avoid disabling the button on type errors
  // alone — let the zod parse drive the actual error display. Just block
  // when any required string is empty so the button feels responsive.
  const hasMinimalInput =
    form.name.trim().length > 0 &&
    form.latitude.trim().length > 0 &&
    form.longitude.trim().length > 0 &&
    form.radius.trim().length > 0;

  const isSaving = createMut.isPending || updateMut.isPending;

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <PageContainer
      title={t('geofences.title', 'Geofences')}
      subtitle={t('geofences.subtitle', 'Define locations for contextual tracking and automation')}
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
            {t('geofences.addGeofence', 'Add Geofence')}
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
                label={t('geofences.totalGeofences', 'Total Geofences')}
                value={stats.total ?? 0}
                icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
                color="purple"
              />
              <MetricCard
                label={t('geofences.visits.reviewedPlaces', 'Reviewed places')}
                value={stats.reviewed}
                icon={<Check className="h-4 w-4" aria-hidden="true" />}
                color="green"
              />
              <MetricCard
                label={t('geofences.visits.pending', 'Awaiting review')}
                value={stats.pending}
                icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
                color="cyan"
              />
              <MetricCard
                label={t('geofences.visits.candidates', 'Visited candidates')}
                value={candidateQuery.data?.length ?? 0}
                icon={<BatteryCharging className="h-4 w-4" aria-hidden="true" />}
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
              <Select
                value={aiLocationIdRaw}
                onChange={(e) => setAiLocationIdRaw(e.target.value)}
                label={t(
                  'geofences.aiSuggest.pickLocation',
                  'Pick a visited location to draft a geofence around',
                )}
                options={[
                  { value: '', label: t('geofences.visits.select', 'Select a visited place') },
                  ...(candidateQuery.data ?? []).filter((item) => item.name.trim()).map((item) => ({
                    value: String(item.id),
                    label: item.name || `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}`,
                  })),
                ]}
              />
              <Caption>
                {t(
                  'geofences.aiSuggest.pickHint',
                  'Choose a visited location to propose a zone; review the draft before saving.',
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

      {/* 3 — One directory for geofence boundaries, alert controls, charging
          pricing, and session history. */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t(
            'chargingPlaces.workspace.unifiedAria',
            'Places and charging zones',
          )}
        >
          <ChargingPlacesWorkspace
            onReviewCandidate={openCandidate}
            onSelectForTemplate={aiEnabled ? (id) => setAiLocationIdRaw(String(id)) : undefined}
            onAdd={openCreate}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
            onBulkDelete={async (places) => {
              await bulkDelete.mutateAsync(places.map((place) => place.id));
            }}
            deletePending={bulkDelete.isPending}
          />
        </section>
      </FadeIn>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={handleRequestClose}
        title={editingId ? t('geofences.editTitle', 'Edit Geofence') : t('geofences.createTitle', 'Create Geofence')}
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
                    ...(vehicles.length === 0
                      ? [{
                          value: '0',
                          label: t('geofences.chooseVehicle', '— Choose vehicle —'),
                        }]
                      : []),
                    ...vehicles.map((v) => ({
                      value: String(v.id),
                      label: v.display_name || v.vin,
                    })),
                  ]}
                  value={String(selectedVehicleId)}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setVehicleId(Number.isInteger(next) && next > 0 ? next : null);
                  }}
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
                  icon={<Navigation className="h-4 w-4" aria-hidden="true" />}
                  onClick={handleGetLocation}
                  disabled={locationLoading || (locationSource === 'vehicle' && selectedVehicleId <= 0)}
                  loading={locationLoading}
                >
                  {locationLoading
                    ? t('geofences.gettingLocation', 'Getting location…')
                    : t('geofences.getLocation', 'Get Location')}
                </Button>
              )}
            </GlassPanel>
          )}
          <Input
            label={t('geofences.formName', 'Name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('geofences.namePlaceholder', 'Home')}
            error={fieldErrors.name}
          />
          {reviewCandidate && (
            <GlassPanel className="space-y-2 p-3">
              <PanelTitle>{t('geofences.visits.confirm', 'Confirm detected location')}</PanelTitle>
              <HelperText>{t('geofences.visits.evidence', '{{visits}} visits · {{charges}} confirmed charges', { visits: reviewCandidate.visit_count, charges: reviewCandidate.charge_count })}</HelperText>
              <Toggle
                label={t('geofences.visits.charging', 'This is a charging location')}
                checked={chargingPlace}
                onChange={setChargingPlace}
              />
              {chargingPlace && <HelperText>{t('geofences.visits.rateHint', 'After saving, open this place to set a rate effective before its first charge.')}</HelperText>}
            </GlassPanel>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('geofences.latitude', 'Latitude')}
              type="number"
              step="any"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              placeholder="37.7749"
              icon={<Globe className="h-4 w-4" aria-hidden="true" />}
              error={fieldErrors.latitude}
            />
            <Input
              label={t('geofences.longitude', 'Longitude')}
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
            label={t('geofences.radiusMeters', 'Radius (meters)')}
            type="number"
            value={form.radius}
            onChange={(e) => setForm({ ...form, radius: e.target.value })}
            placeholder="100"
            icon={<Ruler className="h-4 w-4" aria-hidden="true" />}
            hint={t('geofences.radiusHint', 'Minimum 10m, maximum 50000m')}
            error={fieldErrors.radius}
          />

          <Select
            label={t('chargingPlaces.detail.category', 'Category')}
            options={GEOFENCE_CATEGORY_VALUES.map((value) => ({
              value,
              label: t(
                GEOFENCE_CATEGORY_LABELS[value].key,
                GEOFENCE_CATEGORY_LABELS[value].fallback,
              ),
            }))}
            value={form.category}
            onChange={(e) =>
              setForm({
                ...form,
                category: e.target.value as GeofenceFormData['category'],
              })
            }
            error={fieldErrors.category}
          />

          {!reviewCandidate && !editingId && (
            <Toggle
              label={t('geofences.visits.charging', 'This is a charging location')}
              checked={chargingPlace}
              onChange={setChargingPlace}
            />
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={handleRequestClose} icon={<X className="h-4 w-4" aria-hidden="true" />}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!hasMinimalInput || isSaving}
              loading={isSaving}
              icon={<Check className="h-4 w-4" aria-hidden="true" />}
            >
              {editingId ? t('common.update', 'Update') : t('common.create', 'Create')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Discard-changes confirm dialog (mounted alongside the modal). */}
      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('geofences.deleteTitle', 'Delete Geofence')}
        message={t('geofences.deleteMessage', 'Are you sure you want to delete "{{name}}"? This action cannot be undone.', {
          name: deleteTarget?.name ?? '',
        })}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) deleteMut.mutate(String(deleteTarget.id));
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageContainer>
  );
}
