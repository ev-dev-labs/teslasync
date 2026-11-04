import { useId } from 'react';

/** Historical energy totals do not establish that the connector is currently charging. */
export function ChargeConnector() {
  const id = useId();
  return (
    <svg viewBox="0 0 114 88" aria-hidden="true" focusable="false" className="h-20 w-24 max-w-full shrink-0">
      <defs>
        <linearGradient id={`${id}-housing`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--semantic-info)" stopOpacity=".18" />
          <stop offset="1" stopColor="var(--semantic-success)" stopOpacity=".3" />
        </linearGradient>
      </defs>
      <rect x="16" y="5" width="44" height="62" rx="11" fill={`url(#${id}-housing)`} stroke="var(--semantic-info)" strokeWidth="1.5" />
      <path d="M27 18h22" stroke="var(--semantic-info)" strokeWidth="2" strokeLinecap="round" />
      <path d="m40 29-8 12h8l-4 12 12-17h-9l4-7" fill="var(--semantic-success)" />
      <path d="M38 68v4c0 12 48 12 48-5V44" fill="none" stroke="var(--semantic-info)" strokeWidth="3" strokeLinecap="round" />
      <rect x="79" y="33" width="14" height="17" rx="4" fill="var(--surface-2)" stroke="var(--semantic-info)" strokeWidth="2" />
      <path d="M83 27v6m6-6v6" stroke="var(--semantic-warning)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
