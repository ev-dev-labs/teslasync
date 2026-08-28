/**
 * Accessibility primitives barrel.
 *
 * Use these instead of ad-hoc `<span class="sr-only">` spans or
 * one-off `aria-live` regions. The `audit:sr-only` script enforces
 * that the bare Tailwind class never reappears outside the
 * VisuallyHidden implementation itself.
 */

export {
  VisuallyHidden,
  type VisuallyHiddenProps,
  type VisuallyHiddenOwnProps,
} from './VisuallyHidden';
export { AnnouncerRegion } from './AnnouncerRegion';
export { RouteAnnouncer, type RouteAnnouncerProps } from './RouteAnnouncer';
export {
  RouteFocusManager,
  type RouteFocusManagerProps,
  FOCUS_TIMEOUT_MS,
} from './RouteFocusManager';
