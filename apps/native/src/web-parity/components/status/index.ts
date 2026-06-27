// Native parity port of web/src/components/status/index.ts.
//
// Barrel for the status component family. Mirrors the web source's eight exported
// components and their public types one-for-one, re-exported from the native-safe
// sibling ports. Native-only capability constants (documenting the browser-only
// scroll-spy / scroll-to-top / hover-tooltip behaviour that has no React Native
// equivalent) are additionally surfaced, matching the native a11y barrel pattern.
// This file imports no DOM modules, browser HTML elements, Recharts, Leaflet, or
// web UI components.

export {StatusHero, type StatusHeroProps, type HeroStatus} from './StatusHero';
export {
  StickyChipBar,
  stickyChipBarCapabilities,
  type StickyChipBarProps,
  type ChipItem,
} from './StickyChipBar';
export {
  StickyCompactHero,
  type StickyCompactHeroProps,
} from './StickyCompactHero';
export {HealthRow, type HealthRowProps} from './HealthRow';
export {ActionItem, type ActionItemProps, type ActionSeverity} from './ActionItem';
export {ActionItemsPanel, type ActionItemsPanelProps} from './ActionItemsPanel';
export {
  ResourcesPanel,
  type ResourcesPanelProps,
  type ResourceRow,
} from './ResourcesPanel';
export {
  UptimeHeatmap,
  type UptimeHeatmapProps,
  type UptimeDay,
} from './UptimeHeatmap';
