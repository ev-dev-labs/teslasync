// Native parity port of
// web/src/features/driving/components/drive-detail/index.ts.
//
// The web source is a 20-line barrel that re-exports the building blocks of the
// Drive Detail feature from their own sibling modules:
//   export { DriveDetailSkeleton } from './DriveDetailSkeleton';
//   export { DriveDetailHeader }   from './DriveDetailHeader';
//   export { HeroGauges }          from './HeroGauges';
//   export { DriveTimeline }       from './DriveTimeline';
//   export { DriveStatCards }      from './DriveStatCards';
//   export { MoreDetailsPanel }    from './MoreDetailsPanel';
//   export { EnergySummaryPanel }  from './EnergySummaryPanel';
//   export { CostSavingsPanel }    from './CostSavingsPanel';
//   export { RouteMapSection }     from './RouteMapSection';
//   export { JourneyDetailsPanel } from './JourneyDetailsPanel';
//   export { DriveOverviewChart }  from './DriveOverviewChart';
//   export { SocChart }            from './SocChart';
//   export { ElevationChart }      from './ElevationChart';
//   export { TemperatureSection }  from './TemperatureSection';
//   export { SpeedHistogramChart } from './SpeedHistogramChart';
//   export { PowerProfileChart }   from './PowerProfileChart';
//   export { TirePressureSection } from './TirePressureSection';
//   export { WhyEndedPanel }       from './WhyEndedPanel';
//   export { useDriveDetailData }  from './useDriveDetailData';
//   export type { ChartDataPoint, DriveStats, SpeedSegment, SpeedHistogramBucket } from './types';
//
// In this file-by-file native conversion every sibling is its own conversion
// target, exactly like DriveOverviewChart which is already ported next to this
// barrel. Re-exporting a not-yet-ported './DriveDetailSkeleton' (etc.) would
// break `tsc --noEmit`, so this native barrel surfaces only the siblings whose
// native module exists today and grows as the remaining components, the
// useDriveDetailData hook and the ./types module land in later iterations. The
// public export names and ordering are kept byte-identical to the web barrel so
// each future re-export is a drop-in: when a sibling module is ported,
// uncomment its line below.
//
// Converted today (native module exists):
export { DriveOverviewChart } from './DriveOverviewChart';
export { TirePressureSection } from './TirePressureSection';

// Pending native conversion targets — restore the matching web line here as each
// sibling module is ported (the names/order already match the web barrel):
//   export { DriveDetailSkeleton } from './DriveDetailSkeleton';
//   export { DriveDetailHeader }   from './DriveDetailHeader';
//   export { HeroGauges }          from './HeroGauges';
//   export { DriveTimeline }       from './DriveTimeline';
//   export { DriveStatCards }      from './DriveStatCards';
//   export { MoreDetailsPanel }    from './MoreDetailsPanel';
//   export { EnergySummaryPanel }  from './EnergySummaryPanel';
//   export { CostSavingsPanel }    from './CostSavingsPanel';
//   export { RouteMapSection }     from './RouteMapSection';
//   export { JourneyDetailsPanel } from './JourneyDetailsPanel';
//   export { SocChart }            from './SocChart';
//   export { ElevationChart }      from './ElevationChart';
//   export { TemperatureSection }  from './TemperatureSection';
//   export { SpeedHistogramChart } from './SpeedHistogramChart';
//   export { PowerProfileChart }   from './PowerProfileChart';
//   export { WhyEndedPanel }       from './WhyEndedPanel';
//   export { useDriveDetailData }  from './useDriveDetailData';
//   export type { ChartDataPoint, DriveStats, SpeedSegment, SpeedHistogramBucket } from './types';
