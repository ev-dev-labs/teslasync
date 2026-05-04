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
}

/**
 * Builds the Service-filter dropdown option list directly from
 * `stats.by_service`. This is the same source of truth the "By Service:"
 * chip row already uses, so the dropdown is guaranteed to stay in sync
 * with the data — new service tags written by Go code appear
 * automatically without any frontend follow-up.
 *
 * Sorting: count DESC (most-used first), with stable secondary sort by
 * label ASC for deterministic output across renders.
 *
 * Resilience: when `activeService` is set but absent from `byService`
 * (e.g. the user selected a service that has zero rows in the last
 * 24 h stats window), the active value is appended at the end so the
 * `<Select>` doesn't show a blank value and the user can clear the
 * filter via the option itself.
 *
 * The returned array always starts with the "All Services" option.
 */
export function deriveServiceOptions(opts: DeriveOpts): ServiceSelectOption[] {
  const { byService, activeService, labelFor, allLabel } = opts;
  const head: ServiceSelectOption = { value: '', label: allLabel };

  const entries = Object.entries(byService ?? {}).map(
    ([value, count]): [ServiceSelectOption, number] => [
      { value, label: labelFor(value) },
      count,
    ],
  );

  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].label.localeCompare(b[0].label);
  });

  const tail = entries.map(([opt]) => opt);

  // Retain a selected-but-absent value so the Select can render its
  // current state instead of falling back to a blank.
  if (activeService && !tail.some((o) => o.value === activeService)) {
    tail.push({ value: activeService, label: labelFor(activeService) });
  }

  return [head, ...tail];
}
