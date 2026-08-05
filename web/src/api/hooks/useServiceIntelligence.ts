import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request, SudoCanceledError } from '../client';
import { STALE_TIMES } from '@/lib/constants';
import { useMutationToast } from './_toastHelpers';

export { SudoCanceledError };

export type ServiceIntelligenceSourceStatus = 'available' | 'stale' | 'unavailable';
export type ServiceIntelligenceApplicability =
  | 'potentially_applicable'
  | 'needs_review'
  | 'unlikely';
export type ServiceIntelligenceConfidenceLabel = 'high' | 'medium' | 'low';
export type ServiceIntelligenceSeverity = 'critical' | 'warning' | 'info';

export interface ServiceIntelligenceSource {
  id: string;
  name: string;
  status: ServiceIntelligenceSourceStatus;
  record_count: number;
  fetched_at: string | null;
  checked_at: string;
  expires_at: string | null;
  from_cache: boolean;
  source_url: string;
  detail: string | null;
}

export interface ServiceIntelligenceVehicleContext {
  make: string;
  model: string;
  model_year: number;
  build_date: string | null;
  build_match_basis: string;
  plant_country: string | null;
  plant_state: string | null;
  plant_city: string | null;
  firmware_version: string | null;
}

export interface ServiceIntelligenceSummary {
  recall_candidates: number;
  potentially_applicable_recalls: number;
  manufacturer_communications: number;
  symptom_matches: number;
}

export interface ServiceIntelligenceMatchFactor {
  dimension: string;
  status: string;
  weight: number;
  detail: string;
}

export interface ServiceIntelligenceSymptomMatch {
  finding_id: string;
  signal: string;
  component: string;
  severity: ServiceIntelligenceSeverity;
  observed_at: string;
  score: number;
  evidence: string;
}

export interface ServiceIntelligenceFinding {
  id: string;
  kind: 'recall';
  title: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  report_received_at: string | null;
  applicability: ServiceIntelligenceApplicability;
  confidence: number;
  confidence_label: ServiceIntelligenceConfidenceLabel;
  completion_status: 'unknown';
  hypothesis: string;
  match_factors: ServiceIntelligenceMatchFactor[];
  symptom_matches: ServiceIntelligenceSymptomMatch[];
  park_it: boolean;
  park_outside: boolean;
  over_the_air_update: boolean;
  source_document_url: string;
}

export interface ServiceIntelligenceCommunication {
  id: string;
  nhtsa_id: string;
  communication_number: string;
  communication_type: string;
  manufacturer: string;
  model: string;
  model_year: number;
  published_at: string | null;
  component: string;
  summary: string;
  applicability: ServiceIntelligenceApplicability;
  confidence: number;
  confidence_label: ServiceIntelligenceConfidenceLabel;
  hypothesis: string;
  match_factors: ServiceIntelligenceMatchFactor[];
  symptom_matches: ServiceIntelligenceSymptomMatch[];
  source_document_url: string;
}

export interface ServiceIntelligenceEvidenceItem {
  id: string;
  kind: string;
  title: string;
  summary: string;
  source_name: string;
  source_document_url: string | null;
  observed_at: string | null;
  confidence: number | null;
  finding_id: string | null;
}

export interface ServiceIntelligenceEvidenceBundle {
  schema_version: string;
  items: ServiceIntelligenceEvidenceItem[];
  limitations: string[];
  disclaimer: string;
}

export interface ServiceIntelligenceResponse {
  vehicle_id: number;
  generated_at: string;
  vehicle_context: ServiceIntelligenceVehicleContext;
  summary: ServiceIntelligenceSummary;
  recall_findings: ServiceIntelligenceFinding[];
  communications: ServiceIntelligenceCommunication[];
  ranked_symptoms: ServiceIntelligenceSymptomMatch[];
  evidence: ServiceIntelligenceEvidenceBundle;
  sources: ServiceIntelligenceSource[];
}

export type CommunicationsImportStatusValue = 'running' | 'succeeded' | 'failed';

export interface CommunicationsImportStatus {
  id: number;
  artifact_url: string;
  source_etag: string | null;
  source_last_modified: string | null;
  artifact_sha256: string | null;
  status: CommunicationsImportStatusValue;
  total_rows: number;
  imported_rows: number;
  rejected_rows: number;
  not_modified: boolean;
  error_detail: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface CommunicationsCatalogStatus {
  latest_attempt: CommunicationsImportStatus | null;
  latest_successful: CommunicationsImportStatus | null;
  record_count: number;
}

export const OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS = [
  {
    period: '2005–2009',
    url: 'https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_2005-2009.zip',
  },
  {
    period: '2010–2014',
    url: 'https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_2010-2014.zip',
  },
  {
    period: '2015–2019',
    url: 'https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_2015-2019.zip',
  },
  {
    period: '2020–2024',
    url: 'https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_2020-2024.zip',
  },
  {
    period: '2025–2026',
    url: 'https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_2025-2026.zip',
  },
] as const;

export type OfficialNHTSACommunicationsArtifactURL =
  (typeof OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS)[number]['url'];

export const serviceIntelligenceKeys = {
  catalog: ['service-intelligence', 'communications-catalog'] as const,
  vehicles: ['service-intelligence', 'vehicles'] as const,
  detail: (vehicleId: number | null, refresh: boolean) =>
    [...serviceIntelligenceKeys.vehicles, vehicleId, { refresh }] as const,
};

export function useServiceIntelligence(vehicleId: number | null, refresh = false) {
  return useQuery({
    queryKey: serviceIntelligenceKeys.detail(vehicleId, refresh),
    queryFn: ({ signal }) =>
      request<ServiceIntelligenceResponse>(
        `/service-intelligence/vehicles/${vehicleId}?refresh=${refresh}`,
        { signal },
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.ANALYTICS,
  });
}

export function useCommunicationsCatalogStatus() {
  return useQuery({
    queryKey: serviceIntelligenceKeys.catalog,
    queryFn: ({ signal }) =>
      request<CommunicationsCatalogStatus>(
        '/admin/service-intelligence/communications/status',
        { signal },
      ),
    staleTime: STALE_TIMES.MODERATE,
    retry: 1,
  });
}

function isOfficialArtifactURL(
  artifactURL: string,
): artifactURL is OfficialNHTSACommunicationsArtifactURL {
  return OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS.some(
    (artifact) => artifact.url === artifactURL,
  );
}

export function useImportCommunicationsCatalog() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation<
    CommunicationsImportStatus,
    Error,
    OfficialNHTSACommunicationsArtifactURL
  >({
    mutationFn: (artifactURL) => {
      if (!isOfficialArtifactURL(artifactURL)) {
        return Promise.reject(new Error('Unsupported NHTSA communications artifact'));
      }
      return request<CommunicationsImportStatus>(
        '/admin/service-intelligence/communications/import',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artifact_url: artifactURL }),
        },
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: serviceIntelligenceKeys.catalog }),
        queryClient.invalidateQueries({ queryKey: serviceIntelligenceKeys.vehicles }),
      ]);
      success(
        'serviceIntelligence.catalog.importSuccess',
        'Official NHTSA communications catalog imported',
      );
    },
    onError: (importError) => {
      if (importError instanceof SudoCanceledError) return;
      error(
        importError,
        'serviceIntelligence.catalog.importError',
        'Failed to import the NHTSA communications catalog',
      );
    },
  });
}
