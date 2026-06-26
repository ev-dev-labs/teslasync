/**
 * Native parity port of
 * web/src/features/notifications/components/LegacyNotificationsRedirect.tsx.
 *
 * LegacyNotificationsRedirect — Smart query-aware redirect from the legacy
 * `/notifications?tab=…` route to the new top-level Notifications routes.
 * Forwards remaining search params so filter/search state survives.
 *   /notifications                → /notifications/inbox
 *   /notifications?tab=inbox      → /notifications/inbox
 *   /notifications?tab=archived   → /notifications/archived
 *   /notifications?tab=channels   → /notifications/channels
 *
 * The web file is pure routing glue: it reads `react-router-dom`'s
 * `useLocation().search`, rewrites it through TAB_TO_ROUTE, and emits a
 * `<Navigate to={…} replace />`. None of those primitives exist on native, so —
 * mirroring the sibling router ports (ScrollRestoration, RouteAnnouncer,
 * AlertCard) — every web-only piece is rebuilt native-safe with IDENTICAL
 * route-resolution behavior:
 *   * react-router-dom useLocation().search -> a native-safe `search` prop the
 *     native navigation shell supplies (the legacy deep-link query string).
 *   * react-router-dom <Navigate to={to} replace /> -> a module-level
 *     navigation sink (legacyNotificationsRedirectNavigate /
 *     setLegacyNotificationsRedirectNavigator) fired from an effect with
 *     `{ replace: true }`, exactly as AlertCard replaced its <Link>. With no
 *     navigator wired the redirect is a no-op a host overrides.
 *   * URLSearchParams (get/delete/toString) -> a tiny native-safe ordered
 *     parse/serialize pair so no URL polyfill is required (same approach
 *     AlertCard used for its drill-through href). For the conventional
 *     filter/search query values that survive this redirect the output is
 *     byte-identical to URLSearchParams.
 *
 * No DOM, no react-router-dom, no browser HTML elements, no Recharts, no
 * Leaflet, no framer-motion and no old web UI components are imported.
 */

import {useEffect} from 'react';

/** Default destination when the tab is missing/unknown (web fallback verbatim). */
export const LEGACY_NOTIFICATIONS_DEFAULT_ROUTE = '/notifications/inbox';

// Ported verbatim from the web source.
const TAB_TO_ROUTE: Record<string, string> = {
  inbox: '/notifications/inbox',
  archived: '/notifications/archived',
  channels: '/notifications/channels',
};

/* ------------------------------------------------------------------ */
/*  Native navigation sink (react-router-dom <Navigate replace> port)  */
/* ------------------------------------------------------------------ */

export interface LegacyNotificationsNavigateOptions {
  /** Mirrors react-router's <Navigate replace />: replace history, don't push. */
  replace?: boolean;
}

export type LegacyNotificationsNavigate = (
  to: string,
  options?: LegacyNotificationsNavigateOptions,
) => void;

// The web rendered <Navigate to={to} replace />. The native parity tree mounts
// no router here, so the redirect defaults to a no-op a host can override with
// its real navigation (e.g. a React Navigation reset). Both the parity contract
// and AlertCard establish this module-level sink convention.
let legacyNotificationsRedirectNavigate: LegacyNotificationsNavigate = () => {};

export function setLegacyNotificationsRedirectNavigator(
  fn: LegacyNotificationsNavigate,
): void {
  legacyNotificationsRedirectNavigate = fn;
}

/**
 * Records which browser capabilities the web file used are unavailable on
 * native, so the unavailable state is explicit and programmatically
 * inspectable (parity-contract rule 7).
 */
export const nativeLegacyNotificationsRedirectCapabilities = {
  reactRouterLocationAvailable: false,
  reactRouterNavigateAvailable: false,
  urlSearchParamsAvailable: false,
} as const;

/* ------------------------------------------------------------------ */
/*  URLSearchParams port (native-safe, no URL polyfill required)       */
/* ------------------------------------------------------------------ */

type QueryPair = readonly [key: string, value: string];

// Decode an application/x-www-form-urlencoded component the way URLSearchParams
// does on parse: '+' -> space, then percent-decode. Malformed percent sequences
// (which URLSearchParams tolerates but decodeURIComponent rejects) fall back to
// the raw token so a bad query never throws.
function decodeComponent(value: string): string {
  const spaced = value.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

// Encode an application/x-www-form-urlencoded component the way
// URLSearchParams.toString() does on serialize: percent-encode, then space as
// '+'. Byte-identical to URLSearchParams for the conventional vehicle_id /
// search / filter values this redirect forwards.
function encodeComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

// Parse `location.search` into ordered key/value pairs. Mirrors the
// URLSearchParams constructor: a leading '?' is stripped, empty segments are
// skipped, and a value-less `key` decodes to an empty-string value.
function parseSearch(search: string): QueryPair[] {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) {
    return [];
  }
  const pairs: QueryPair[] = [];
  for (const segment of raw.split('&')) {
    if (segment === '') {
      continue;
    }
    const eq = segment.indexOf('=');
    if (eq === -1) {
      pairs.push([decodeComponent(segment), '']);
    } else {
      pairs.push([
        decodeComponent(segment.slice(0, eq)),
        decodeComponent(segment.slice(eq + 1)),
      ]);
    }
  }
  return pairs;
}

// URLSearchParams.get: first value for a key, or null when absent. Returning
// null (not '') preserves the web `params.get('tab') ?? 'inbox'` semantics —
// an absent tab falls back to 'inbox' while a present-but-empty `tab=` keeps the
// empty string (which then resolves to the default route).
function getFirst(pairs: QueryPair[], key: string): string | null {
  for (const [k, v] of pairs) {
    if (k === key) {
      return v;
    }
  }
  return null;
}

// URLSearchParams.delete: drop every entry for a key, preserving order.
function deleteKey(pairs: QueryPair[], key: string): QueryPair[] {
  return pairs.filter(([k]) => k !== key);
}

// URLSearchParams.toString: ordered `k=v` joined by '&'.
function serialize(pairs: QueryPair[]): string {
  return pairs
    .map(([k, v]) => `${encodeComponent(k)}=${encodeComponent(v)}`)
    .join('&');
}

/* ------------------------------------------------------------------ */
/*  Pure route resolution (value-identical to the web computation)     */
/* ------------------------------------------------------------------ */

/**
 * Resolves the legacy `/notifications?tab=…&…` query string to the new
 * top-level route, forwarding the remaining (non-`tab`) params so filter/search
 * state survives. Pure and side-effect free — the exact logic the web component
 * ran inline before emitting <Navigate>.
 */
export function resolveLegacyNotificationsTarget(search: string): string {
  const params = parseSearch(search);
  const tab = getFirst(params, 'tab') ?? 'inbox';
  const remaining = deleteKey(params, 'tab');
  const target = TAB_TO_ROUTE[tab] ?? LEGACY_NOTIFICATIONS_DEFAULT_ROUTE;
  const qs = serialize(remaining);
  return qs ? `${target}?${qs}` : target;
}

/* ------------------------------------------------------------------ */
/*  LegacyNotificationsRedirect                                        */
/* ------------------------------------------------------------------ */

export interface LegacyNotificationsRedirectProps {
  /**
   * Native-safe replacement for react-router-dom `useLocation().search` — the
   * legacy deep-link query string (with or without a leading '?'). The native
   * navigation shell supplies it; defaults to '' (the bare `/notifications`
   * case, which redirects to the inbox).
   */
  search?: string;
}

/**
 * Parity export mirroring the web `<Navigate to={…} replace />`: it renders
 * nothing (returns null) and performs the redirect as a side effect via the
 * module-level navigation sink, replacing history exactly as the web `replace`
 * prop did.
 */
export default function LegacyNotificationsRedirect({
  search = '',
}: LegacyNotificationsRedirectProps = {}): null {
  const to = resolveLegacyNotificationsTarget(search);

  useEffect(() => {
    legacyNotificationsRedirectNavigate(to, {replace: true});
  }, [to]);

  return null;
}
