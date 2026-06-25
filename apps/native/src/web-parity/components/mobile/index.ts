/**
 * Mobile gesture primitives barrel (native parity port).
 *
 * Pull-to-refresh + swipe-to-action wrappers. On the web these add native-feel
 * touch interactions to mobile lists; in React Native the underlying DOM touch
 * gesture layer (TouchEvent, passive listeners, navigator.vibrate) is
 * unavailable, so both primitives render their children straight through and
 * document the native alternatives (RefreshControl / Swipeable) via the
 * exported capability constants.
 */

export {
  PullToRefresh,
  nativePullToRefreshCapabilities,
  type PullToRefreshProps,
} from './PullToRefresh';
export {
  SwipeRow,
  nativeSwipeRowCapabilities,
  type SwipeRowProps,
  type SwipeAction,
} from './SwipeRow';
