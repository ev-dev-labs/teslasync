/**
 * LegacyAlertRulesRedirect — Redirects /alert-rules → /notifications/rules
 * preserving any search params.
 */

import { Navigate, useLocation } from 'react-router';

export default function LegacyAlertRulesRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/notifications/rules${search}`} replace />;
}
