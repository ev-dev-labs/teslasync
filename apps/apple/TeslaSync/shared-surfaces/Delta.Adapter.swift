//
//  Delta.Adapter.swift
//  TeslaSync — P4 shared surface · 0081 · Delta (Apple)
//
//  The Foundation-only core for the direction-aware change indicator — the SwiftUI parity of
//  components/data-display/Delta.tsx. This file holds the surface identity (the diagnostics slug), the
//  metric-semantics registry the web source reads from lib/metricSemantics.ts (``DeltaDirection`` /
//  ``DeltaMetricUnit`` / ``DeltaMetricSemantic`` + the ``DeltaMetricRegistry`` lookup), the metric
//  input union (``DeltaMetric``), the render-form / scale axes (``DeltaDisplay`` / ``DeltaSize``), and
//  the props value type (``DeltaInputs``). No SwiftUI and no `@Observable`, so every rule is
//  unit-testable in isolation.
//
//  Faithful-parity note: the web `<Delta>` is a PURE presentational component. Its only "hooks" are
//  the i18n facade (`useTranslation`) and the display-boundary unit/format facades (`useUnits` /
//  `useFormatting`, consumed via the inline `useUnitLabels`) — there is no fetch, no React-Query
//  cache, no Promise. It maps `(metric, current, previous, …) → <span>` with exactly three render
//  branches: a forced skeleton (`loading`), a muted em-dash when either endpoint is missing /
//  non-finite (the faithful "empty"), and a sign-/tone-decorated indicator otherwise. It therefore has
//  NO error, stale, or offline branch — there is nothing to fail, age, or lose connectivity to.
//  Inventing such chrome would fabricate states the source does not have (and contradict the web
//  spec), so this surface reproduces only the source's REAL branches — exactly as the sibling
//  presentational primitives MetricCard (0095) and BatteryDelta (0077) did. The three real branches:
//    • loading   — the forced skeleton (web `if (loading) return <Skeleton/>`).
//    • empty     — `current`/`previous` absent or non-finite → the muted "—" (+ optional `comparedTo`).
//    • value     — both present + finite → the arrow + percent / absolute / both value + `comparedTo`.
//
//  Boundary note: the web `<Delta>` takes its `current` / `previous` ALREADY in the metric's display
//  units (caller-converted); it never performs SI conversion. The unit/format facades are read ONLY to
//  resolve the affix labels (mi/km, kWh, currency symbol, …) and the locale-aware grouping — the same
//  boundary the web hooks draw. Affix resolution lives in Delta.Projection.swift; here we only model
//  the inputs.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web component is named `Delta`; this surface keeps the same slug here (SwiftUI-free) so the
/// state-holder can emit telemetry without depending on the view layer.
public enum DeltaSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "Delta"
}

// MARK: - DeltaDirection (web `Direction`)

/// Direction-is-good for a metric — the native peer of the web `Direction` union
/// (lib/metricSemantics.ts). Drives the indicator colour: a `higherBetter` rise renders favorable, a
/// `lowerBetter` rise renders unfavorable, and `neutral` is never coloured good / bad.
public enum DeltaDirection: String, Sendable, Equatable, CaseIterable {
    /// A rise is good — favorable on a rise (web `higher_better`).
    case higherBetter = "higher_better"
    /// A drop is good — favorable on a drop (web `lower_better`).
    case lowerBetter = "lower_better"
    /// Never coloured good / bad — always neutral (web `neutral`).
    case neutral
}

// MARK: - DeltaMetricUnit (web `MetricUnit`)

/// The unit hint used to pick the affix — the native peer of the web `MetricUnit` union. The raw
/// values are byte-identical to the web tokens so a parity table can round-trip them. The web's
/// single-character tokens (`'h'`, `'c'`, `'f'`) are given descriptive case names with explicit raw
/// values (Swift identifier-length lint forbids one-character names), preserving the wire token.
public enum DeltaMetricUnit: String, Sendable, Equatable, CaseIterable {
    /// A monetary amount — prefixed with the locale currency symbol (web `currency`).
    case currency
    /// A percentage — suffixed `%` (web `percent`).
    case percent
    /// Miles — suffixed with the user's distance label (web `mi`).
    case mi
    /// Kilometres — suffixed with the user's distance label (web `km`).
    case km
    /// Kilowatt-hours — suffixed `kWh` (web `kwh`).
    case kwh
    /// Watt-hours — suffixed `Wh` (web `wh`).
    case wh
    /// Energy per distance — suffixed `Wh/mi` or `Wh/km` per the user's distance unit (web `wh_per_mi`).
    case whPerMi = "wh_per_mi"
    /// Hours — suffixed `h` (web `h`).
    case hours = "h"
    /// Minutes — suffixed `min` (web `min`).
    case minutes = "min"
    /// A dimensionless count — no affix (web `count`).
    case count
    /// Miles per hour — suffixed with the user's speed label (web `mph`).
    case mph
    /// Kilometres per hour — suffixed with the user's speed label (web `kph`).
    case kph
    /// Celsius — suffixed with the user's temperature label (web `c`).
    case celsius = "c"
    /// Fahrenheit — suffixed with the user's temperature label (web `f`).
    case fahrenheit = "f"
    /// Pressure — suffixed with the user's pressure label (web `bar`).
    case bar
}

// MARK: - DeltaMetricSemantic (web `MetricSemantic`)

/// A resolved metric semantic — the native peer of the web `MetricSemantic` (`{ id, direction, unit?
/// }`). Pairs an id with its favorable direction and optional unit hint.
public struct DeltaMetricSemantic: Sendable, Equatable {
    /// The metric id (snake_case for parity with backend JSON tags).
    public let id: String
    /// Which direction of change is favorable.
    public let direction: DeltaDirection
    /// The unit hint used to resolve the affix; `nil` renders no affix.
    public let unit: DeltaMetricUnit?

    public init(id: String, direction: DeltaDirection, unit: DeltaMetricUnit? = nil) {
        self.id = id
        self.direction = direction
        self.unit = unit
    }
}

// MARK: - DeltaMetric (web `metric` prop union)

/// The `metric` prop — the native peer of the web union `MetricId | MetricSemantic | { direction;
/// unit? }`. A caller passes a registered id (`.id("range")`), an explicit semantic
/// (`.semantic(...)`), or a one-off inline pair (`.inline(direction:unit:)`).
public enum DeltaMetric: Sendable, Equatable {
    /// A registered (or unknown) metric id — resolved through ``DeltaMetricRegistry``.
    case id(String)
    /// An explicit, already-resolved semantic.
    case semantic(DeltaMetricSemantic)
    /// A one-off inline metric — the web `{ direction, unit? }` object.
    case inline(direction: DeltaDirection, unit: DeltaMetricUnit?)
}

// MARK: - DeltaMetricRegistry (web `METRIC_SEMANTICS` + `resolveSemantic`)

/// The registry of common metrics + the resolver — the native port of the web `METRIC_SEMANTICS`
/// table and `resolveSemantic()` (lib/metricSemantics.ts). Unknown ids resolve to a `neutral`,
/// unitless semantic so the surface never crashes on a typo, exactly like the web fallback.
public enum DeltaMetricRegistry {
    /// The registered metrics, keyed by id (verbatim port of the web `METRIC_SEMANTICS`).
    public static let semantics: [String: DeltaMetricSemantic] = [
        "cost": .init(id: "cost", direction: .lowerBetter, unit: .currency),
        "cost_per_mi": .init(id: "cost_per_mi", direction: .lowerBetter, unit: .currency),
        "energy_consumed": .init(id: "energy_consumed", direction: .lowerBetter, unit: .kwh),
        "energy_per_mi": .init(id: "energy_per_mi", direction: .lowerBetter, unit: .whPerMi),
        "range": .init(id: "range", direction: .higherBetter, unit: .mi),
        "efficiency": .init(id: "efficiency", direction: .lowerBetter, unit: .whPerMi),
        "regen_pct": .init(id: "regen_pct", direction: .higherBetter, unit: .percent),
        "drive_score": .init(id: "drive_score", direction: .higherBetter, unit: .count),
        "vampire_drain": .init(id: "vampire_drain", direction: .lowerBetter, unit: .kwh),
        "idle_time": .init(id: "idle_time", direction: .lowerBetter, unit: .hours),
        "distance": .init(id: "distance", direction: .neutral, unit: .mi),
        "trip_count": .init(id: "trip_count", direction: .neutral, unit: .count),
        "charging_sessions": .init(id: "charging_sessions", direction: .neutral, unit: .count),
        "battery_health_pct": .init(id: "battery_health_pct", direction: .higherBetter, unit: .percent),
        "speed_avg": .init(id: "speed_avg", direction: .neutral, unit: .mph),
        "temperature": .init(id: "temperature", direction: .neutral, unit: .celsius),
        "pressure": .init(id: "pressure", direction: .neutral, unit: .bar)
    ]

    /// Resolves a ``DeltaMetric`` to a ``DeltaMetricSemantic`` — the verbatim port of the web
    /// `resolveSemantic`. A registered id returns its entry; an unknown id falls back to
    /// `{ id, direction: .neutral }`; a `.semantic` is returned as-is; an `.inline` becomes
    /// `{ id: "inline", direction, unit }`.
    public static func resolve(_ metric: DeltaMetric) -> DeltaMetricSemantic {
        switch metric {
        case let .id(identifier):
            if let found = semantics[identifier] {
                return found
            }
            return DeltaMetricSemantic(id: identifier, direction: .neutral)
        case let .semantic(semantic):
            return semantic
        case let .inline(direction, unit):
            return DeltaMetricSemantic(id: "inline", direction: direction, unit: unit)
        }
    }
}

// MARK: - DeltaDisplay (web `display`)

/// Which form to render — the native peer of the web `display` prop. `percent` (the web default)
/// shows the relative change, `absolute` the raw difference, `both` the absolute with the percent in
/// parentheses.
public enum DeltaDisplay: String, Sendable, Equatable, CaseIterable {
    case percent
    case absolute
    case both

    /// The web default (`display = 'percent'`).
    public static let defaultDisplay: DeltaDisplay = .percent
}

// MARK: - DeltaSize (web `size`)

/// The text + icon scale — the native peer of the web `size` prop. `sm` (the web default) uses the
/// caption font + a 14pt skeleton, `md` the body font + a 16pt skeleton.
public enum DeltaSize: String, Sendable, Equatable, CaseIterable {
    case sm
    case md

    /// The web default (`size = 'sm'`).
    public static let defaultSize: DeltaSize = .sm
}

// MARK: - DeltaInputs (web props)

/// The component's props — the native peer of `DeltaProps`. A value type so the view, the
/// state-holder, and the pure projection all agree on one shape, and so a SwiftUI `.onChange` can
/// detect a prop change cheaply when a reused indicator rebinds. `current` / `previous` are `Double?`
/// (the web `number | null | undefined`); a `nil` maps the web `null`/`undefined`, and a non-finite
/// `Double` maps the web `!Number.isFinite` case — both resolve to the muted "—" empty branch.
public struct DeltaInputs: Sendable, Equatable {
    /// The metric — a registered id, an explicit semantic, or an inline pair (web `metric`).
    public let metric: DeltaMetric
    /// Current-period value, in display units (web `current`); `nil` / non-finite → the empty branch.
    public let current: Double?
    /// Previous-period value, in display units (web `previous`); `nil` / non-finite → the empty branch.
    public let previous: Double?
    /// Percent / absolute / both (web `display`, default `percent`).
    public let display: DeltaDisplay
    /// Trailing label such as "vs last week" (web `comparedTo`).
    public let comparedTo: String?
    /// Text + icon scale (web `size`, default `sm`).
    public let size: DeltaSize
    /// Render in a tight inline chip (`true`, web default) versus a roomier stat row (`false`).
    public let inline: Bool
    /// Hide the directional arrow (web `hideArrow`).
    public let hideArrow: Bool
    /// Force the loading skeleton (web `loading`).
    public let loading: Bool
    /// Override the decimal precision (web `precision`; percent defaults to 1).
    public let precision: Int?

    public init(
        metric: DeltaMetric,
        current: Double?,
        previous: Double?,
        display: DeltaDisplay = .defaultDisplay,
        comparedTo: String? = nil,
        size: DeltaSize = .defaultSize,
        inline: Bool = true,
        hideArrow: Bool = false,
        loading: Bool = false,
        precision: Int? = nil
    ) {
        self.metric = metric
        self.current = current
        self.previous = previous
        self.display = display
        self.comparedTo = comparedTo
        self.size = size
        self.inline = inline
        self.hideArrow = hideArrow
        self.loading = loading
        self.precision = precision
    }
}
