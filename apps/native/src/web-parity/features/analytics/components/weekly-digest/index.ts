// Native parity port of
// web/src/features/analytics/components/weekly-digest/index.ts.
//
// The web source is a 12-line barrel that re-exports the twelve building blocks
// of the Weekly Digest feature from their own sibling modules:
//   export { HighlightCard }        from './HighlightCard';
//   export { MiniStat }             from './MiniStat';
//   export { BatteryPill }          from './BatteryPill';
//   export { DigestSkeleton }       from './DigestSkeleton';
//   export { WeekSelector }         from './WeekSelector';
//   export { SummaryHeroCards }     from './SummaryHeroCards';
//   export { DrivingSection }       from './DrivingSection';
//   export { ChargingSection }      from './ChargingSection';
//   export { BatteryHealthSection } from './BatteryHealthSection';
//   export { AlertsSection }        from './AlertsSection';
//   export { WeekOverWeekSummary }  from './WeekOverWeekSummary';
//   export { useWeeklyDigest }      from './useWeeklyDigest';
//
// In this file-by-file native conversion every sibling is its own conversion
// target, exactly like BatteryHealthSection which is already ported next to this
// barrel. Re-exporting a not-yet-ported './HighlightCard' (etc.) would break
// `tsc --noEmit`, so this native barrel surfaces only the siblings whose native
// module exists today and grows as the remaining ten components and the
// useWeeklyDigest hook land in later iterations. The public export names and
// ordering are kept byte-identical to the web barrel so each future re-export is
// a drop-in: when a sibling module is ported, uncomment its line below.
//
// Converted today (native module exists):
export { BatteryHealthSection } from './BatteryHealthSection';

// Pending native conversion targets — restore the matching web line here as each
// sibling module is ported (the names/order already match the web barrel):
//   export { HighlightCard }       from './HighlightCard';
//   export { MiniStat }            from './MiniStat';
//   export { BatteryPill }         from './BatteryPill';
//   export { DigestSkeleton }      from './DigestSkeleton';
//   export { WeekSelector }        from './WeekSelector';
//   export { SummaryHeroCards }    from './SummaryHeroCards';
//   export { DrivingSection }      from './DrivingSection';
//   export { ChargingSection }     from './ChargingSection';
//   export { AlertsSection }       from './AlertsSection';
//   export { WeekOverWeekSummary } from './WeekOverWeekSummary';
//   export { useWeeklyDigest }     from './useWeeklyDigest';
