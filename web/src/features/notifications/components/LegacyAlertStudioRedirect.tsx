/**
 * LegacyAlertStudioRedirect — Redirects the legacy `/alert-studio` route to
 * the relocated `/notifications/studio` route, forwarding the *whole* deep-link
 * context so existing draft-restore links and email CTAs keep working after the
 * move:
 *   - `search` params (e.g. `?id=42`, `?signals=…&from=signal-diff`)
 *   - the `hash` anchor (e.g. `#channels`) — a search-only forward silently
 *     dropped it, breaking in-page anchor deep links from emails/docs
 *   - navigation `state` carried by in-app `navigate('/alert-studio', { state })`
 *
 * The redirect is a history `replace` so the dead legacy URL never lands in the
 * back-stack.
 */

import { Navigate, useLocation } from 'react-router-dom';

/** Where the relocated Alert Studio now lives. */
const ALERT_STUDIO_TARGET = '/notifications/studio';

export default function LegacyAlertStudioRedirect() {
  const { search, hash, state } = useLocation();
  return (
    <Navigate
      to={{ pathname: ALERT_STUDIO_TARGET, search, hash }}
      state={state}
      replace
    />
  );
}
