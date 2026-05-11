/**
 * LegacyAlertStudioRedirect — Redirects /alert-studio →
 * /notifications/studio, preserving any search params. Keeps existing
 * draft restore links + email CTAs working.
 */

import { Navigate, useLocation } from 'react-router-dom';

export default function LegacyAlertStudioRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/notifications/studio${search}`} replace />;
}
