import type { UnitFormatter } from '@/hooks/useUnits';
import type { CabinThermalSummary } from '../../lib/cabinThermal';

export interface LedgerFact {
  id: string;
  raw: number | null;
  value: string | null;
}

/** Display adapter only: do not recalculate populations or substitute missing τ with zero. */
export function presentCabinThermalLedger(
  summary: CabinThermalSummary,
  resolved: boolean,
  fmtInt: (value: unknown) => string,
  formatDuration: UnitFormatter,
): LedgerFact[] {
  const count = (id: string, raw: number | null | undefined): LedgerFact => {
    const known = resolved && typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    return { id, raw: known, value: known == null ? null : fmtInt(known) };
  };
  const tau = resolved && summary.tauMin != null && Number.isFinite(summary.tauMin)
    ? summary.tauMin * 60 : null;
  const tauSeconds = tau != null && Number.isFinite(tau) ? tau : null;
  return [
    count('returned', summary.accounting.returnedRows),
    count('normalized', summary.accounting.normalizedRows),
    count('candidates', summary.accounting.candidateWindows),
    count('accepted', summary.accounting.acceptedFits),
    count('rejected', summary.accounting.rejectedCandidates),
    { id: 'tau', raw: tauSeconds, value: tauSeconds == null ? null : formatDuration(tauSeconds) },
  ];
}
