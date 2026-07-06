/**
 * LegacyAlertRulesRedirect — Redirects /alert-rules → /notifications/rules
 * preserving any search params AND the URL hash fragment so legacy deep
 * links (bookmarks, email CTAs, in-app anchors) keep landing on the exact
 * same place. Dropping the fragment silently broke `#anchor` deep links.
 */

import { Navigate, useLocation } from 'react-router-dom';

export default function LegacyAlertRulesRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={`/notifications/rules${search}${hash}`} replace />;
}
