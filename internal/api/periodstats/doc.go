// Package periodstats serves GET /api/v1/analytics/period-stats (the deterministic
// period comparison endpoint consumed by the SPA's PeriodComparePage chart) AND
// exports the SHARED pure helper [ComputePeriodStats] + [PeriodStats] envelope
// that the AI period-compare-narration adapter consumes.
//
// Wire-shape stability: the canonical /api/v1/analytics/period-stats JSON shape
// is byte-identical with the pre-refactor inline literal. Keep the snake_case
// field list stable so the chart and AI narration continue to quote the same
// deterministic per-period aggregate.
//
// All math.Round + safeF guards live inside ComputePeriodStats, NOT in the
// handler, so the chart and the AI envelope see the SAME rounded numbers.
//
// Layer: handler
package periodstats
