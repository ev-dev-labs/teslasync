import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useMutationToast } from './_toastHelpers';
import type {
  AssignDriveRequest,
  ChargingInvoice,
  ComplianceApportionment,
  ComplianceFiling,
  ConsumableEvent,
  ConsumableItem,
  ConsumablesReport,
  CreateClaimRequest,
  CreateConsumableEventRequest,
  CreateConsumableItemRequest,
  CreateDisputeRequest,
  CreateDriverProfileRequest,
  CreateFilingRequest,
  CreateInvoiceRequest,
  CreateJurisdictionRateRequest,
  CreateSubscriptionRequest,
  CreateTariffRequest,
  CreateWarrantyRequest,
  DriverAttributionReport,
  DriverProfile,
  GovernanceOverview,
  GovernanceSimulationRequest,
  GovernanceSimulationResponse,
  InsurancePolicy,
  InsuranceRiskProfile,
  InvoiceDispute,
  JurisdictionRate,
  ModelTrustReport,
  OwnershipList,
  OwnershipPage,
  Prediction,
  ReconciliationReport,
  RecordOutcomeRequest,
  RecordPredictionRequest,
  RetentionPolicy,
  RetentionRun,
  Subscription,
  SubscriptionROIReport,
  Tariff,
  TariffSimulationRequest,
  TariffSimulationResponse,
  UpsertInsurancePolicyRequest,
  UpsertRetentionPolicyRequest,
  Warranty,
  WarrantyClaim,
  WarrantyOverview,
} from '@/types/ownership';

/**
 * Ownership intelligence hooks.
 *
 * The shared `request()` client already prefixes `/api/v1`, so every path here
 * is relative to that root. All query parameters use snake_case to match the
 * Go handler's `r.URL.Query().Get(...)` reads.
 */

const INSURANCE = '/insurance-telematics';
const TARIFF = '/tariff-lab';
const RECONCILE = '/charging-reconciliation';
const DRIVER = '/driver-attribution';
const WARRANTY = '/warranty-command';
const GOVERNANCE = '/data-governance';
const TRUST = '/model-trust';
const COMPLIANCE = '/jurisdiction-compliance';
const CONSUMABLES = '/consumables-lifecycle';
const SUBSCRIPTION = '/subscription-roi';

export const ownershipKeys = {
  all: ['ownership-intel'] as const,
  insurance: (vehicleId: number | null, windowDays: number) =>
    [...ownershipKeys.all, 'insurance', vehicleId, windowDays] as const,
  tariffs: (limit: number, offset: number) =>
    [...ownershipKeys.all, 'tariffs', limit, offset] as const,
  invoices: (vehicleId: number | null, limit: number, offset: number) =>
    [...ownershipKeys.all, 'invoices', vehicleId, limit, offset] as const,
  invoiceReport: (invoiceId: number | null) =>
    [...ownershipKeys.all, 'invoice-report', invoiceId] as const,
  driver: (vehicleId: number | null, windowDays: number, limit: number, offset: number) =>
    [...ownershipKeys.all, 'driver', vehicleId, windowDays, limit, offset] as const,
  driverProfiles: (vehicleId: number | null) =>
    [...ownershipKeys.all, 'driver-profiles', vehicleId] as const,
  warranty: (vehicleId: number | null) => [...ownershipKeys.all, 'warranty', vehicleId] as const,
  warranties: (vehicleId: number | null) =>
    [...ownershipKeys.all, 'warranties', vehicleId] as const,
  governance: () => [...ownershipKeys.all, 'governance'] as const,
  governanceRuns: (limit: number, offset: number) =>
    [...ownershipKeys.all, 'governance-runs', limit, offset] as const,
  trust: (vehicleId: number | null, windowDays: number) =>
    [...ownershipKeys.all, 'model-trust', vehicleId, windowDays] as const,
  compliance: (vehicleId: number | null, windowDays: number) =>
    [...ownershipKeys.all, 'compliance', vehicleId, windowDays] as const,
  jurisdictionRates: () => [...ownershipKeys.all, 'jurisdiction-rates'] as const,
  filings: (vehicleId: number | null, limit: number, offset: number) =>
    [...ownershipKeys.all, 'filings', vehicleId, limit, offset] as const,
  consumables: (vehicleId: number | null) =>
    [...ownershipKeys.all, 'consumables', vehicleId] as const,
  consumableItems: (vehicleId: number | null) =>
    [...ownershipKeys.all, 'consumable-items', vehicleId] as const,
  subscriptionRoi: (vehicleId: number | null, windowDays: number) =>
    [...ownershipKeys.all, 'subscription-roi', vehicleId, windowDays] as const,
  subscriptions: (vehicleId: number | null) =>
    [...ownershipKeys.all, 'subscriptions', vehicleId] as const,
};

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

function isValidVehicle(vehicleId: number | null): vehicleId is number {
  return vehicleId != null && vehicleId > 0;
}

/** Shared vehicle-scoped GET wrapper: disabled until a vehicle is selected. */
function useVehicleQuery<T>(key: readonly unknown[], path: string, vehicleId: number | null) {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => {
      if (!isValidVehicle(vehicleId)) {
        throw new Error('vehicle_id must be a positive integer');
      }
      return request<T>(path, { signal });
    },
    enabled: isValidVehicle(vehicleId),
  });
}

// ---------------------------------------------------------------------------
// 1. Insurance telematics
// ---------------------------------------------------------------------------

export function useInsuranceRiskProfile(vehicleId: number | null, windowDays = 90) {
  return useVehicleQuery<InsuranceRiskProfile>(
    ownershipKeys.insurance(vehicleId, windowDays),
    `${INSURANCE}${query({ vehicle_id: vehicleId ?? undefined, window_days: windowDays })}`,
    vehicleId,
  );
}

export function useUpsertInsurancePolicy() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: UpsertInsurancePolicyRequest) =>
      request<InsurancePolicy>(`${INSURANCE}/policy`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.insurance.toast.saved', 'Insurance policy saved');
    },
    onError: (error) =>
      toast.error(error, 'ownership.insurance.toast.error', 'Failed to save insurance policy'),
  });
}

export function useDeleteInsurancePolicy() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`${INSURANCE}/policy/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.insurance.toast.deleted', 'Insurance policy removed');
    },
    onError: (error) =>
      toast.error(error, 'ownership.insurance.toast.deleteError', 'Failed to remove policy'),
  });
}

// ---------------------------------------------------------------------------
// 2. Tariff arbitrage lab
// ---------------------------------------------------------------------------

export function useTariffs(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ownershipKeys.tariffs(limit, offset),
    queryFn: ({ signal }) =>
      request<OwnershipPage<Tariff>>(`${TARIFF}/tariffs${query({ limit, offset })}`, { signal }),
  });
}

export function useCreateTariff() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: CreateTariffRequest) =>
      request<Tariff>(`${TARIFF}/tariffs`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.tariff.toast.created', 'Tariff plan created');
    },
    onError: (error) =>
      toast.error(error, 'ownership.tariff.toast.error', 'Failed to create tariff plan'),
  });
}

export function useDeleteTariff() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request<void>(`${TARIFF}/tariffs/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.tariff.toast.deleted', 'Tariff plan removed');
    },
    onError: (error) =>
      toast.error(error, 'ownership.tariff.toast.deleteError', 'Failed to remove tariff plan'),
  });
}

export function useSimulateTariffs() {
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: TariffSimulationRequest) =>
      request<TariffSimulationResponse>(`${TARIFF}/simulate`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => toast.success('ownership.tariff.toast.simulated', 'Tariff comparison ready'),
    onError: (error) =>
      toast.error(error, 'ownership.tariff.toast.simulateError', 'Tariff comparison failed'),
  });
}

// ---------------------------------------------------------------------------
// 3. Charging invoice reconciliation
// ---------------------------------------------------------------------------

export function useChargingInvoices(vehicleId: number | null, limit = 25, offset = 0) {
  return useVehicleQuery<OwnershipPage<ChargingInvoice>>(
    ownershipKeys.invoices(vehicleId, limit, offset),
    `${RECONCILE}/invoices${query({ vehicle_id: vehicleId ?? undefined, limit, offset })}`,
    vehicleId,
  );
}

export function useReconciliationReport(invoiceId: number | null) {
  return useQuery({
    queryKey: ownershipKeys.invoiceReport(invoiceId),
    queryFn: ({ signal }) => {
      if (invoiceId == null || invoiceId <= 0) {
        throw new Error('invoice id must be a positive integer');
      }
      return request<ReconciliationReport>(`${RECONCILE}/invoices/${invoiceId}/report`, { signal });
    },
    enabled: invoiceId != null && invoiceId > 0,
  });
}

export function useCreateInvoice() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: CreateInvoiceRequest) =>
      request<ChargingInvoice>(`${RECONCILE}/invoices`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.reconcile.toast.created', 'Invoice imported');
    },
    onError: (error) =>
      toast.error(error, 'ownership.reconcile.toast.error', 'Failed to import invoice'),
  });
}

export function useDeleteInvoice() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request<void>(`${RECONCILE}/invoices/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.reconcile.toast.deleted', 'Invoice removed');
    },
    onError: (error) =>
      toast.error(error, 'ownership.reconcile.toast.deleteError', 'Failed to remove invoice'),
  });
}

export function useCreateDispute(invoiceId: number | null) {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: CreateDisputeRequest) => {
      if (invoiceId == null || invoiceId <= 0) {
        throw new Error('invoice id must be a positive integer');
      }
      return request<InvoiceDispute>(`${RECONCILE}/invoices/${invoiceId}/disputes`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.reconcile.toast.disputed', 'Dispute opened');
    },
    onError: (error) =>
      toast.error(error, 'ownership.reconcile.toast.disputeError', 'Failed to open dispute'),
  });
}

// ---------------------------------------------------------------------------
// 4. Driver attribution
// ---------------------------------------------------------------------------

export function useDriverAttribution(
  vehicleId: number | null,
  windowDays = 90,
  limit = 50,
  offset = 0,
) {
  return useVehicleQuery<DriverAttributionReport>(
    ownershipKeys.driver(vehicleId, windowDays, limit, offset),
    `${DRIVER}${query({
      vehicle_id: vehicleId ?? undefined,
      window_days: windowDays,
      limit,
      offset,
    })}`,
    vehicleId,
  );
}

export function useDriverProfiles(vehicleId: number | null) {
  return useVehicleQuery<OwnershipList<DriverProfile>>(
    ownershipKeys.driverProfiles(vehicleId),
    `${DRIVER}/profiles${query({ vehicle_id: vehicleId ?? undefined })}`,
    vehicleId,
  );
}

export function useCreateDriverProfile() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: CreateDriverProfileRequest) =>
      request<DriverProfile>(`${DRIVER}/profiles`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.driver.toast.created', 'Driver profile created');
    },
    onError: (error) =>
      toast.error(error, 'ownership.driver.toast.error', 'Failed to create driver profile'),
  });
}

export function useDeleteDriverProfile() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request<void>(`${DRIVER}/profiles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.driver.toast.deleted', 'Driver profile removed');
    },
    onError: (error) =>
      toast.error(error, 'ownership.driver.toast.deleteError', 'Failed to remove driver profile'),
  });
}

export function useAssignDrive() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: AssignDriveRequest) =>
      request<void>(`${DRIVER}/assignments`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.driver.toast.assigned', 'Drive attributed');
    },
    onError: (error) =>
      toast.error(error, 'ownership.driver.toast.assignError', 'Failed to attribute drive'),
  });
}

// ---------------------------------------------------------------------------
// 5. Warranty command
// ---------------------------------------------------------------------------

export function useWarrantyOverview(vehicleId: number | null) {
  return useVehicleQuery<WarrantyOverview>(
    ownershipKeys.warranty(vehicleId),
    `${WARRANTY}${query({ vehicle_id: vehicleId ?? undefined })}`,
    vehicleId,
  );
}

export function useWarranties(vehicleId: number | null) {
  return useVehicleQuery<OwnershipList<Warranty>>(
    ownershipKeys.warranties(vehicleId),
    `${WARRANTY}/warranties${query({ vehicle_id: vehicleId ?? undefined })}`,
    vehicleId,
  );
}

export function useCreateWarranty() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: CreateWarrantyRequest) =>
      request<Warranty>(`${WARRANTY}/warranties`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.warranty.toast.created', 'Coverage registered');
    },
    onError: (error) =>
      toast.error(error, 'ownership.warranty.toast.error', 'Failed to register coverage'),
  });
}

export function useDeleteWarranty() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request<void>(`${WARRANTY}/warranties/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.warranty.toast.deleted', 'Coverage removed');
    },
    onError: (error) =>
      toast.error(error, 'ownership.warranty.toast.deleteError', 'Failed to remove coverage'),
  });
}

export function useCreateWarrantyClaim() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: CreateClaimRequest) =>
      request<WarrantyClaim>(`${WARRANTY}/claims`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.warranty.toast.claimed', 'Claim recorded');
    },
    onError: (error) =>
      toast.error(error, 'ownership.warranty.toast.claimError', 'Failed to record claim'),
  });
}

// ---------------------------------------------------------------------------
// 6. Data governance
// ---------------------------------------------------------------------------

export function useGovernanceOverview() {
  return useQuery({
    queryKey: ownershipKeys.governance(),
    queryFn: ({ signal }) => request<GovernanceOverview>(GOVERNANCE, { signal }),
  });
}

export function useRetentionRuns(limit = 25, offset = 0) {
  return useQuery({
    queryKey: ownershipKeys.governanceRuns(limit, offset),
    queryFn: ({ signal }) =>
      request<OwnershipPage<RetentionRun>>(`${GOVERNANCE}/runs${query({ limit, offset })}`, {
        signal,
      }),
  });
}

export function useUpsertRetentionPolicy() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: UpsertRetentionPolicyRequest) =>
      request<RetentionPolicy>(`${GOVERNANCE}/policies`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.governance.toast.saved', 'Retention policy saved');
    },
    onError: (error) =>
      toast.error(error, 'ownership.governance.toast.error', 'Failed to save retention policy'),
  });
}

export function useDeleteRetentionPolicy() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request<void>(`${GOVERNANCE}/policies/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.governance.toast.deleted', 'Retention policy removed');
    },
    onError: (error) =>
      toast.error(error, 'ownership.governance.toast.deleteError', 'Failed to remove policy'),
  });
}

export function useSimulateGovernance() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: GovernanceSimulationRequest) =>
      request<GovernanceSimulationResponse>(`${GOVERNANCE}/simulate`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.governanceRuns(25, 0) });
      toast.success('ownership.governance.toast.simulated', 'Dry run complete');
    },
    onError: (error) =>
      toast.error(error, 'ownership.governance.toast.simulateError', 'Dry run failed'),
  });
}

// ---------------------------------------------------------------------------
// 7. Model trust
// ---------------------------------------------------------------------------

export function useModelTrust(vehicleId: number | null, windowDays = 180) {
  return useVehicleQuery<ModelTrustReport>(
    ownershipKeys.trust(vehicleId, windowDays),
    `${TRUST}${query({ vehicle_id: vehicleId ?? undefined, window_days: windowDays })}`,
    vehicleId,
  );
}

export function useRecordPrediction() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: RecordPredictionRequest) =>
      request<Prediction>(`${TRUST}/predictions`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.trust.toast.recorded', 'Prediction logged');
    },
    onError: (error) =>
      toast.error(error, 'ownership.trust.toast.error', 'Failed to log prediction'),
  });
}

export function useRecordOutcome() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: RecordOutcomeRequest) =>
      request<Prediction>(`${TRUST}/outcomes`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.trust.toast.scored', 'Outcome scored');
    },
    onError: (error) =>
      toast.error(error, 'ownership.trust.toast.scoreError', 'Failed to score outcome'),
  });
}

// ---------------------------------------------------------------------------
// 8. Jurisdictional compliance
// ---------------------------------------------------------------------------

export function useComplianceApportionment(vehicleId: number | null, windowDays = 365) {
  return useVehicleQuery<ComplianceApportionment>(
    ownershipKeys.compliance(vehicleId, windowDays),
    `${COMPLIANCE}${query({ vehicle_id: vehicleId ?? undefined, window_days: windowDays })}`,
    vehicleId,
  );
}

export function useJurisdictionRates() {
  return useQuery({
    queryKey: ownershipKeys.jurisdictionRates(),
    queryFn: ({ signal }) =>
      request<OwnershipList<JurisdictionRate>>(`${COMPLIANCE}/rates`, { signal }),
  });
}

export function useCreateJurisdictionRate() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: CreateJurisdictionRateRequest) =>
      request<JurisdictionRate>(`${COMPLIANCE}/rates`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.compliance.toast.rateCreated', 'Jurisdiction registered');
    },
    onError: (error) =>
      toast.error(error, 'ownership.compliance.toast.error', 'Failed to register jurisdiction'),
  });
}

export function useDeleteJurisdictionRate() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request<void>(`${COMPLIANCE}/rates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.compliance.toast.rateDeleted', 'Jurisdiction removed');
    },
    onError: (error) =>
      toast.error(error, 'ownership.compliance.toast.deleteError', 'Failed to remove jurisdiction'),
  });
}

export function useComplianceFilings(vehicleId: number | null, limit = 25, offset = 0) {
  return useVehicleQuery<OwnershipPage<ComplianceFiling>>(
    ownershipKeys.filings(vehicleId, limit, offset),
    `${COMPLIANCE}/filings${query({ vehicle_id: vehicleId ?? undefined, limit, offset })}`,
    vehicleId,
  );
}

export function useCreateFiling() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: CreateFilingRequest) =>
      request<ComplianceFiling>(`${COMPLIANCE}/filings`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.compliance.toast.filed', 'Filing sealed');
    },
    onError: (error) =>
      toast.error(error, 'ownership.compliance.toast.fileError', 'Failed to seal filing'),
  });
}

// ---------------------------------------------------------------------------
// 9. Consumables lifecycle
// ---------------------------------------------------------------------------

export function useConsumablesReport(vehicleId: number | null) {
  return useVehicleQuery<ConsumablesReport>(
    ownershipKeys.consumables(vehicleId),
    `${CONSUMABLES}${query({ vehicle_id: vehicleId ?? undefined })}`,
    vehicleId,
  );
}

export function useConsumableItems(vehicleId: number | null) {
  return useVehicleQuery<OwnershipList<ConsumableItem>>(
    ownershipKeys.consumableItems(vehicleId),
    `${CONSUMABLES}/items${query({ vehicle_id: vehicleId ?? undefined })}`,
    vehicleId,
  );
}

export function useCreateConsumable() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: CreateConsumableItemRequest) =>
      request<ConsumableItem>(`${CONSUMABLES}/items`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.consumables.toast.created', 'Wear part registered');
    },
    onError: (error) =>
      toast.error(error, 'ownership.consumables.toast.error', 'Failed to register wear part'),
  });
}

export function useDeleteConsumable() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request<void>(`${CONSUMABLES}/items/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.consumables.toast.deleted', 'Wear part removed');
    },
    onError: (error) =>
      toast.error(error, 'ownership.consumables.toast.deleteError', 'Failed to remove wear part'),
  });
}

export function useCreateConsumableEvent() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: CreateConsumableEventRequest) =>
      request<ConsumableEvent>(`${CONSUMABLES}/events`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.consumables.toast.logged', 'Service event logged');
    },
    onError: (error) =>
      toast.error(error, 'ownership.consumables.toast.logError', 'Failed to log service event'),
  });
}

// ---------------------------------------------------------------------------
// 10. Subscription ROI
// ---------------------------------------------------------------------------

export function useSubscriptionROI(vehicleId: number | null, windowDays = 365) {
  return useVehicleQuery<SubscriptionROIReport>(
    ownershipKeys.subscriptionRoi(vehicleId, windowDays),
    `${SUBSCRIPTION}${query({ vehicle_id: vehicleId ?? undefined, window_days: windowDays })}`,
    vehicleId,
  );
}

export function useSubscriptions(vehicleId: number | null) {
  return useVehicleQuery<OwnershipList<Subscription>>(
    ownershipKeys.subscriptions(vehicleId),
    `${SUBSCRIPTION}/subscriptions${query({ vehicle_id: vehicleId ?? undefined })}`,
    vehicleId,
  );
}

export function useCreateSubscription() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: CreateSubscriptionRequest) =>
      request<Subscription>(`${SUBSCRIPTION}/subscriptions`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.subscription.toast.created', 'Subscription registered');
    },
    onError: (error) =>
      toast.error(error, 'ownership.subscription.toast.error', 'Failed to register subscription'),
  });
}

export function useDeleteSubscription() {
  const client = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`${SUBSCRIPTION}/subscriptions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownershipKeys.all });
      toast.success('ownership.subscription.toast.deleted', 'Subscription removed');
    },
    onError: (error) =>
      toast.error(
        error,
        'ownership.subscription.toast.deleteError',
        'Failed to remove subscription',
      ),
  });
}
