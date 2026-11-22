export type ServiceCaseKind = 'warning' | 'condition' | 'firmware' | 'recorded_work';

export interface ServiceCaseEntry {
  kind: ServiceCaseKind;
  detail: string;
  observed_at: string;
}

export interface PrivateServiceCase {
  id: number;
  version: number;
  title: string;
  opened_at: string;
  evidence: Array<ServiceCaseEntry & { id: number }>;
}

export interface ServiceCaseSelection {
  id: number;
  include_detail: boolean;
  include_time: boolean;
}

export interface CaseReview {
  document: {
    format: 'service_case_evidence_v1';
    provenance: 'user_recorded';
    evidence: Array<Pick<ServiceCaseEntry, 'kind'> & Partial<Omit<ServiceCaseEntry, 'kind'>>>;
  };
  digest: string;
}
