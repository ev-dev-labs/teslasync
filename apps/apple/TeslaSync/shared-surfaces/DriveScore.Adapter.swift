//
//  DriveScore.Adapter.swift
//  TeslaSync — P4 shared surface · 0082 · DriveScore (Apple)
//
//  The testable, dependency-light core for the drive-quality score — the SwiftUI parity of
//  components/data-display/DriveScore.tsx. This file is the Foundation-only heart of the native peer:
//  the surface identity (the diagnostics slug), the scoring constants (lifted verbatim from the web
//  `computeDriveScore`), the four weighted axes (``DriveScoreSurfaceCategory``), the quality band
//  (``DriveScoreSurfaceBand`` — the web `getScoreColor` thresholds), and the props value type
//  (``DriveScoreSurfaceInputs``). No SwiftUI, no `@Observable` — so every rule is unit testable in
//  isolation.
//
//  Namespacing note: the app module already ships two unrelated dashboard widgets in the
//  `DriveScore*` namespace — `DriveScoreWidget` (DriveScoreModel / DriveScoreProjection /
//  DriveScoreBand / DriveScoreStrings / DriveScoreTelemetry) and `DriveScoreGaugeWidget`
//  (GaugeDriveScoreBand …). This shared surface is the parity of the WEB `DriveScore` data-display
//  component (a different artifact), so every supporting type here is uniquely prefixed
//  `DriveScoreSurface*` to avoid duplicate-type collisions; only the public SwiftUI view keeps the
//  bare parity name `DriveScore`.
//
//  Faithful-parity note (states): the web `DriveScore` is a PURE presentational component. Its only
//  data source is `useTranslation` (the i18n facade) — it takes a `drive` object as a plain prop and
//  maps it through `computeDriveScore` to a gauge + four breakdown bars. There is NO fetch, no
//  React-Query cache, no Promise, so the source has NO loading / error / stale / offline branch
//  (nothing to load, fail, go stale, or lose connectivity to). It also has no explicit "empty"
//  branch: a drive with every field absent still resolves to a finite score (23) and renders the
//  gauge + bars. Inventing loading/error/offline chrome would fabricate states the source does not
//  have and contradict the web spec, so this surface reproduces ONLY the source's real branch — the
//  always-rendered score — exactly as the sibling presentational primitives BatteryDelta (0077),
//  TimeMarker (0074), and ChartTimeRangeContext (0069) did.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web component is named `DriveScore`; this surface keeps that slug here (SwiftUI-free) so the
/// state-holder can emit telemetry without depending on the view layer.
public enum DriveScoreSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DriveScore"
}

// MARK: - Scoring constants (web `computeDriveScore` literals)

/// The literal constants the web `computeDriveScore` uses, named so the projection and its tests
/// share one source of truth. The score is partitioned into a 100-point budget split 40 / 20 / 20 /
/// 20 across the four axes; the energy heuristics (≈75 kWh usable battery → 750 Wh per SoC percent,
/// 150 Wh/km optimal) and the range / trip envelopes are lifted verbatim from the web source.
public enum DriveScoreSurfaceConstants {
    /// Maximum points for the efficiency axis (web `40`).
    public static let efficiencyMaxPoints = 40
    /// Maximum points for the speed-discipline axis (web `20`).
    public static let speedMaxPoints = 20
    /// Maximum points for the range-preservation axis (web `20`).
    public static let rangeMaxPoints = 20
    /// Maximum points for the trip-length axis (web `20`).
    public static let tripMaxPoints = 20
    /// The total score ceiling (web `clamp(…, 0, 100)`).
    public static let maxTotalScore = 100

    /// Meters per kilometre — `distanceM / 1000` (web `distanceKm`).
    public static let metersPerKm = 1000.0
    /// Estimated usable battery Wh per SoC percent — web "~75 kWh usable, each % = 750 Wh".
    public static let usableBatteryWhPerPercent = 750.0
    /// The optimal consumption the efficiency axis rewards (web `optimalWhKm = 150`).
    public static let optimalWhPerKm = 150.0
    /// Assumed Wh/km when there is no distance to derive it from (web `: 250`).
    public static let fallbackWhPerKm = 250.0
    /// Assumed avg/max speed ratio when there is no max speed (web `: 0.5`).
    public static let fallbackSpeedRatio = 0.5
    /// Assumed SoC-per-km when there is no distance (web `: 1`).
    public static let fallbackBatteryPerKm = 1.0
    /// Best-case SoC drain per km for the range axis (web `0.1`).
    public static let rangeBestPerKm = 0.1
    /// The best→worst SoC-per-km span for the range axis (web `0.9`).
    public static let rangeSpanPerKm = 0.9
    /// Distance (km) at which the trip-length axis plateaus at full marks (web `50`).
    public static let tripPlateauKm = 50.0
    /// SoC percent assumed when the start battery is absent (web `?? 100`).
    public static let defaultStartBatteryPct = 100.0
}

// MARK: - DriveScoreSurfaceCategory (web breakdown rows)

/// The four weighted axes the web breakdown renders, in source order. Each carries its point ceiling
/// (web `max`) and the i18n key + English fallback the web `t()` call uses. The accent color lives in
/// DriveScore.Views.swift (token-driven, P1/S9) so it is not duplicated in this Foundation core.
public enum DriveScoreSurfaceCategory: String, Sendable, Equatable, CaseIterable, Identifiable {
    /// Energy efficiency vs the 150 Wh/km optimum — the 40-point axis (web `'Efficiency'`).
    case efficiency
    /// Smoothness, measured as avg/max speed ratio — a 20-point axis (web `'Speed Discipline'`).
    case speedDiscipline
    /// SoC drain per km — a 20-point axis (web `'Range Preservation'`).
    case rangePreservation
    /// Trip distance, plateauing at 50 km — a 20-point axis (web `'Trip Length'`).
    case tripLength

    public var id: String {
        rawValue
    }

    /// The point ceiling for the axis (web `max`).
    public var maxPoints: Int {
        switch self {
        case .efficiency: DriveScoreSurfaceConstants.efficiencyMaxPoints
        case .speedDiscipline: DriveScoreSurfaceConstants.speedMaxPoints
        case .rangePreservation: DriveScoreSurfaceConstants.rangeMaxPoints
        case .tripLength: DriveScoreSurfaceConstants.tripMaxPoints
        }
    }

    /// The P1/S10 i18n key — verbatim from the web `t()` call.
    public var localizationKey: String {
        switch self {
        case .efficiency: "driveScore.efficiency"
        case .speedDiscipline: "driveScore.speedDiscipline"
        case .rangePreservation: "driveScore.rangePreservation"
        case .tripLength: "driveScore.tripLength"
        }
    }

    /// The English fallback — verbatim from the web `t()` default argument.
    public var fallbackLabel: String {
        switch self {
        case .efficiency: "Efficiency"
        case .speedDiscipline: "Speed Discipline"
        case .rangePreservation: "Range Preservation"
        case .tripLength: "Trip Length"
        }
    }
}

// MARK: - DriveScoreSurfaceBand (web `getScoreColor` thresholds)

/// The quality band that colors the gauge — the native peer of the web `getScoreColor`: a total
/// under 40 is ``poor`` (red), under 70 is ``fair`` (amber), otherwise ``good`` (green). Mapped to
/// theme-aware status tokens (P1/S9) in DriveScore.Views.swift, so the gauge recolors across light /
/// dark / high-contrast — an improvement over the web source's fixed hex.
public enum DriveScoreSurfaceBand: String, Sendable, Equatable, CaseIterable {
    /// Total < 40 — web `COLOR.BAD` (#ef4444).
    case poor
    /// 40 ≤ total < 70 — web `COLOR.WARN` (#f59e0b).
    case fair
    /// Total ≥ 70 — web `COLOR.GOOD` (#10b981).
    case good

    /// Classifies a total score into its band — the web `getScoreColor` thresholds applied to the
    /// already-rounded `score.total`.
    public static func classify(total: Int) -> DriveScoreSurfaceBand {
        if total < 40 { return .poor }
        if total < 70 { return .fair }
        return .good
    }
}

// MARK: - DriveScoreSurfaceInputs (web `drive` prop, SI canonical)

/// The component's props — the native peer of the web `DriveLike`. A value type so the view, the
/// state-holder, and the pure projection all agree on one shape, and so a SwiftUI `.onChange` can
/// detect a prop change cheaply. All fields are SI canonical (meters, seconds, m/s, SoC percent),
/// matching the Phase-42 on-disk contract; a `nil` maps the web `null`/`undefined`, resolved by the
/// projector with the same `?? default` chain the web uses. (A non-finite `Double` is also treated as
/// absent — the only divergence from the web, which would propagate `NaN`; real SI drive fields are
/// always finite.)
public struct DriveScoreSurfaceInputs: Sendable, Equatable {
    /// Trip distance in meters (web `distance_m` / `distanceM`); `nil` → 0.
    public let distanceM: Double?
    /// Trip duration in seconds (web `duration_s` / `durationS`); `nil` → 0.
    public let durationS: Double?
    /// Peak speed in m/s (web `max_speed_mps` / `maxSpeedMps`); `nil` → the average speed.
    public let maxSpeedMps: Double?
    /// Starting SoC percent 0–100 (web `start_battery_pct` / `startBatteryPct`); `nil` → 100.
    public let startBatteryPct: Double?
    /// Ending SoC percent 0–100 (web `end_battery_pct` / `endBatteryPct`); `nil` → the start SoC.
    public let endBatteryPct: Double?

    public init(
        distanceM: Double? = nil,
        durationS: Double? = nil,
        maxSpeedMps: Double? = nil,
        startBatteryPct: Double? = nil,
        endBatteryPct: Double? = nil
    ) {
        self.distanceM = distanceM
        self.durationS = durationS
        self.maxSpeedMps = maxSpeedMps
        self.startBatteryPct = startBatteryPct
        self.endBatteryPct = endBatteryPct
    }
}
