export interface ServiceSelectOption {
  value: string;
  label: string;
}

interface DeriveOpts {
  /** stats.by_service from /api-logs/stats; may be undefined while loading. */
  byService: Record<string, number> | undefined;
  /** Currently-selected service value; '' for "All Services". */
  activeService: string;
  /** Maps a raw service key to its display label (uses SERVICE_CONFIG fallback). */
  labelFor: (svc: string) => string;
  /** i18n-translated "All Services" label. */
  allLabel: string;
  /**
   * Static catalog of services the frontend knows the backend can write
   * (the keys of SERVICE_CONFIG). Always present in the dropdown even when
   * they have zero rows in `byService`, so a fresh install or a quiet
   * service (github-releases, eia, tesla-auth, etc.) is still filterable.
   * Sort with count = 0 → lands at the bottom alphabetically.
   * Optional and defaults to []; pass it to opt in to the union behaviour.
   */
  knownServices?: readonly string[];
}

/**
 * Builds the Service-filter dropdown option list as the union of:
 *   1. The static catalog (`knownServices` — keys of SERVICE_CONFIG), so
 *      services that haven't fired yet are still filterable.
 *   2. Live `stats.by_service` keys, so newly-introduced backend tags
 *      appear automatically without any frontend follow-up.
 *   3. The currently-selected `activeService`, so the `<Select>` always
 *      reflects its own value even if the backend hasn't written it yet.
 *
 * Sorting: alphabetical by label (case-insensitive locale compare). The
 * chip row above the filters already surfaces counts, so the dropdown's
 * only job is fast scanning — alphabetical beats the previous count-desc
 * order which left users with a two-tiered "ranked head + alpha tail"
 * list that's hard to scan as the catalog grows.
 *
 * The returned array always starts with the "All Services" option, which
 * stays pinned regardless of label sort.
 */
export function deriveServiceOptions(opts: DeriveOpts): ServiceSelectOption[] {
  const { byService, activeService, labelFor, allLabel, knownServices } = opts;
  const head: ServiceSelectOption = { value: '', label: allLabel };

  const values = new Set<string>();
  for (const svc of knownServices ?? []) values.add(svc);
  for (const svc of Object.keys(byService ?? {})) values.add(svc);
  if (activeService) values.add(activeService);

  const tail: ServiceSelectOption[] = Array.from(values, (value) => ({
    value,
    label: labelFor(value),
  })).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  );

  return [head, ...tail];
}
