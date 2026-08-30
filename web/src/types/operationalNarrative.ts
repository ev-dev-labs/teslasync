export type OperationalConfidenceLabel =
  | 'high'
  | 'medium'
  | 'low'
  | 'not_scored';

export interface OperationalNarrativeConfidence {
  label: OperationalConfidenceLabel;
  score: number | null;
  basis: readonly string[];
}

export interface OperationalNarrativeProvenance {
  source: string;
  recordId?: string | null;
  method?: string | null;
}

export interface OperationalNarrativeEvidence {
  id: string;
  summary: string;
  observedAt: string | null;
  provenance: OperationalNarrativeProvenance;
}

/**
 * Shared decision-support narrative. Nullable fields are intentional:
 * consumers must state when cause or response evidence is unavailable rather
 * than fabricating an explanation to fill the UI.
 */
export interface OperationalNarrative {
  whatChanged: string;
  whyItMatters: string | null;
  confidence: OperationalNarrativeConfidence;
  likelyCause: string | null;
  recommendedResponse: string | null;
  limitations: readonly string[];
  evidence: readonly OperationalNarrativeEvidence[];
  provenance: readonly OperationalNarrativeProvenance[];
}
