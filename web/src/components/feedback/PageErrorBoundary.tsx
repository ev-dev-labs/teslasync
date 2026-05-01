import { type ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

interface PageErrorBoundaryProps {
  children: ReactNode;
  /** Page identifier for log correlation, e.g. "Battery Health". */
  pageName: string;
}

/**
 * Page-level error boundary. Wraps a full page in a thin `ErrorBoundary` so a
 * render failure on one page doesn't take down the surrounding shell (sidebar,
 * top bar, route navigation). Mounted automatically by `<PageContainer>`.
 *
 * Uses the full-page fallback UI from `ErrorBoundary` (icon + retry + go-home).
 */
export function PageErrorBoundary({ children, pageName }: PageErrorBoundaryProps) {
  return <ErrorBoundary name={`page:${pageName}`}>{children}</ErrorBoundary>;
}
