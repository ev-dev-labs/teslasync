export { StatCard } from './StatCard';
export {
  UsageCard,
  type UsageCardProps,
  type UsageCardIntent,
  type UsageCardBudget,
  type UsageCardBand,
  type UsageCardDetail,
  type UsageCardTopList,
  type UsageCardTopListItem,
  type UsageCardBanner,
  type UsageCardFooterLink,
} from './UsageCard';
export { KVList, type KVItem, type KVListProps } from './KVList';
export {
  Avatar,
  avatarColorIndex,
  avatarInitials,
  type AvatarProps,
  type AvatarSize,
  type AvatarShape,
  type AvatarStatus,
  type AvatarKind,
} from './Avatar';
export {
  UserCell,
  type UserCellProps,
  type UserCellUser,
} from './UserCell';
export { StatusBadge } from './StatusBadge';
export { ProgressRing } from './ProgressRing';
export { AnimatedNumber } from './AnimatedNumber';
export { Timeline, type TimelineItemData, type TimelineProps } from './Timeline';
export { RecentActivityFeed, type RecentActivityFeedProps } from './RecentActivityFeed';
export { MetricCard } from './MetricCard';
export { MetricTile, type MetricTileProps } from './MetricTile';
export { InlineMetric } from './InlineMetric';
export { MetricBar } from './MetricBar';
export { TimelineItem, type TimelineItemProps } from './TimelineItem';
export { FSMBadge } from './FSMBadge';
export { TransitionArrow, type TransitionArrowProps } from './TransitionArrow';
export { FreshnessIndicator, useIsStale } from './FreshnessIndicator';
export {
  DataFreshness,
  DataFreshnessAuto,
  FRESHNESS_COLORS,
  type DataFreshnessProps,
  type DataFreshnessAutoProps,
  type FreshnessStatus,
  type FreshnessQuery,
} from './DataFreshness';
export { LiveIndicator, type LiveIndicatorVariant } from './LiveIndicator';
export {
  OperationalModeBadge,
  type OperationalModeBadgeProps,
} from './OperationalModeBadge';
export { Delta, type DeltaProps } from './Delta';
export { ComparisonHeader, type ComparisonHeaderProps } from './ComparisonHeader';
export { KpiOverviewCard, type KpiOverviewCardProps } from './KpiOverviewCard';
export {
  OperationalBrief,
  type OperationalBriefProps,
  type OperationalBriefMetric,
  type OperationalAttention,
  type OperationalTone,
} from './OperationalBrief';
export {
  OperationalNarrativeDetails,
  type OperationalNarrativeDetailsProps,
} from './OperationalNarrativeDetails';
export {
  CalculationDetails,
  type CalculationDetailsProps,
} from './CalculationDetails';
export {
  EntityPreviewDrawer,
  type EntityPreviewDrawerProps,
  type EntityPreviewField,
  type EntityPreviewRelatedAction,
  type EntityPreviewTone,
} from './EntityPreviewDrawer';
export {
  DateGroupedList,
  type DateGroupedListProps,
  type DateGroupedListGroup,
} from './DateGroupedList';
export { TimeStamp, type TimeStampProps, type TimeStampFormat } from './TimeStamp';
export {
  BulkActionsToolbar,
  type BulkAction,
  type BulkActionsToolbarProps,
} from './BulkActionsToolbar';
// Singular-name alias of the same component.
export {
  BulkActionToolbar,
  type BulkActionToolbarProps,
} from './BulkActionToolbar';
export {
  SeverityBadge,
  SeverityIcon,
  type SeverityBadgeProps,
  type SeverityIconProps,
} from './SeverityBadge';
export { StatusDot, type StatusDotProps } from './StatusDot';
export {
  SourceLayerBadge,
  type SourceLayerBadgeProps,
  type SignalSource,
} from './SourceLayerBadge';
export { SavedViewMenu, type SavedViewMenuProps } from './SavedViewMenu';
export { PlaybackControls, type PlaybackControlsProps } from './PlaybackControls';
export {
  PlaybackSpeedMenu,
  type PlaybackSpeedMenuProps,
  REPLAY_SPEEDS,
  nextSpeed,
  shiftSpeed,
} from './PlaybackSpeedMenu';
export {
  TimelineScrubber,
  type TimelineScrubberProps,
  type TimelineMarker,
  type TimelineMarkerKind,
  type TimelinePreviewPoint,
} from './TimelineScrubber';

// Shared row + atom primitives for history-style list pages
// (Drives, Charging, Trips, …). Each is unit-tested in isolation
// and consumed via the page-level wrappers (DriveCard, ChargingSessionCard).
export { HistoryListRow, type HistoryListRowProps } from './HistoryListRow';
export { ScoreBadge, type ScoreBadgeProps } from './ScoreBadge';
export { BatteryDelta, type BatteryDeltaProps } from './BatteryDelta';
export { RouteDisplay, type RouteDisplayProps, type RouteEndpoint, endpointLabel } from './RouteDisplay';

// Centralized format components — see ./format for details
export {
  DateTime,
  Distance,
  Speed,
  Temperature,
  Pressure,
  Energy,
  Power,
  Voltage,
  Current,
  Currency,
  Percentage,
  FormattedNumber,
  Duration,
  Range,
  useRangeLabel,
} from './format';
export type { DateTimeVariant, DurationVariant } from './format';
