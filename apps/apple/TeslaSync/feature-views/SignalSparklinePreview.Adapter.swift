//
//  SignalSparklinePreview.Adapter.swift
//  TeslaSync — P4 feature view · 0271 · SignalSparklinePreview (Apple)
//
//  The testable, Foundation-only projection core for the last-hour mini-trend — a
//  faithful port of the display math in
//  features/telemetry/components/SignalSparklinePreview.tsx. Everything here is pure
//  and dependency-free so the executed host harness and the XCTest suite can prove
//  parity with the web `envelopesToNumbers` / `NON_NUMERIC` / `numericSeries.length`
//  split without rendering a view.
//
//  Web parity notes:
//    • The preview owns its own `useSignalHistory(vehicleId, signal, { hours: 1,
//      limit: 30 })` query; the parent (SignalCategoryTree) flips `enabled` on per
//      leaf as a category expands so it never fires 600+ requests on mount.
//    • `envelopesToNumbers` keeps finite numbers, maps booleans to 1/0, and drops
//      everything else (string / null / non-finite) — exactly the web reducer.
//    • A numeric-kind signal renders the Sparkline once it has >= 2 points
//      (`numericSeries.length < 2` → the "—" no-samples fallback); non-numeric kinds
//      (string / time / unknown) never get a trend line and show the kind chip.
//

import Foundation

// MARK: - Signal value kind (web `SignalKind`)

/// The compact value discriminator carried by a signal descriptor (web `SignalKind`,
/// normalized from `protomodel.ValueKind`). `isNumeric` mirrors the web `NON_NUMERIC`
/// set (`string` / `unknown` / `time` are non-numeric; everything else is numeric),
/// which is exactly the branch the preview keys off for the Sparkline vs kind chip.
public enum SignalSparklineKind: String, Sendable, CaseIterable, Equatable {
    case string
    case bool
    case int
    case float
    case time
    case unknown

    /// Whether the kind has a meaningful numeric trend line (web
    /// `!NON_NUMERIC.has(valueKind)`).
    public var isNumeric: Bool {
        switch self {
        case .bool, .int, .float: true
        case .string, .time, .unknown: false
        }
    }

    /// The compact token shown in the non-numeric chip (web renders `valueKind`
    /// verbatim, e.g. "string"). It is a protocol-level identifier, not prose, so it
    /// is intentionally not localized.
    public var token: String {
        rawValue
    }
}

// MARK: - Envelope value (web `SignalEnvelope.value`)

/// One history sample's value as delivered by the signal-history feed (web
/// `SignalEnvelope.value`, a `number | boolean | string | null`). Modeled as a closed
/// enum so the reducer is total and the unit tests can pin every branch.
public enum SignalSparklineValue: Sendable, Equatable {
    case number(Double)
    case bool(Bool)
    case string(String)
    case null
}

/// One signal-history sample (web `SignalEnvelope`). Only `value` feeds the trend;
/// the optional ISO `timestamp` is carried for parity / future axis labelling and is
/// not used by the projection.
public struct SignalSparklineEnvelope: Sendable, Equatable {
    public let value: SignalSparklineValue
    public let timestamp: String?

    public init(value: SignalSparklineValue, timestamp: String? = nil) {
        self.value = value
        self.timestamp = timestamp
    }
}

// MARK: - Live-state + load envelope

/// Live-stream freshness (ADR-013): drives the freshness affordance + the cached /
/// auto-refresh behaviour. Orthogonal to the data phase.
public enum SignalSparklineConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The bound source's load status for the history feed, projected into a render phase
/// by the model (web tanstack-query `isLoading` / `isError` / settled).
public enum SignalSparklineLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

// MARK: - Projection (web `numericSeries` `useMemo`)

/// The projected numeric series + the derived content/empty split (web
/// `numericSeries` and its `numericSeries.length < 2` test).
public struct SignalSparklineProjection: Sendable, Equatable {
    public let values: [Double]
    public let hasTrend: Bool

    public init(values: [Double], hasTrend: Bool) {
        self.values = values
        self.hasTrend = hasTrend
    }

    /// An empty projection (no samples resolved).
    public static let empty = SignalSparklineProjection(values: [], hasTrend: false)
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with `view.opened`. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum SignalSparklineSurface {
    public static let slug = "SignalSparklinePreview"
}

// MARK: - Fetch + display constants (web module constants + prop defaults)

/// The web module constants (`SPARKLINE_HOURS` / `SPARKLINE_LIMIT`) and the
/// `SignalSparklinePreviewProps` display defaults, kept in one place so the model and
/// the production source agree with the web source.
public enum SignalSparklineConfig {
    /// Web `SPARKLINE_HOURS` — the trailing window the history query covers.
    public static let historyHours = 1
    /// Web `SPARKLINE_LIMIT` — the max samples the history query returns.
    public static let historyLimit = 30
    /// Web `width = 80` default.
    public static let defaultWidth = 80
    /// Web `height = 18` default.
    public static let defaultHeight = 18
    /// The shared-palette index used for the trend line. The web default
    /// `color = '#22d3ee'` is the teal/cyan accent; index 4 is the palette's
    /// cyan-leaning categorical color, the closest index-stable brand match.
    public static let defaultColorIndex = 4
    /// The minimum sample count for a meaningful trend (web `numericSeries.length < 2`
    /// fallback boundary).
    public static let minTrendSamples = 2
}

// MARK: - Builder (port of the web `envelopesToNumbers` + `numericSeries` chain)

/// Pure functions that turn the raw history envelopes into the plot-ready numeric
/// series and resolve the content/empty split — a 1:1 port of the web
/// `envelopesToNumbers` reducer and the `numericSeries` `useMemo` so both platforms
/// draw identical trends.
public enum SignalSparklineBuilder {
    /// Reduces history envelopes to finite plot values (web `envelopesToNumbers`):
    /// finite numbers are kept as-is, booleans collapse to 1 / 0, and everything else
    /// (strings, nulls, non-finite numbers) is dropped.
    public static func numbers(from envelopes: [SignalSparklineEnvelope]) -> [Double] {
        var out: [Double] = []
        out.reserveCapacity(envelopes.count)
        for envelope in envelopes {
            switch envelope.value {
            case let .number(value) where value.isFinite:
                out.append(value)
            case let .bool(flag):
                out.append(flag ? 1 : 0)
            default:
                continue
            }
        }
        return out
    }

    /// Whether the reduced series has enough points for a trend line (web
    /// `numericSeries.length < 2` → `false`).
    public static func hasTrend(_ values: [Double]) -> Bool {
        values.count >= SignalSparklineConfig.minTrendSamples
    }

    /// Builds the projection (web `numericSeries` + its content/empty boundary).
    public static func project(from envelopes: [SignalSparklineEnvelope]) -> SignalSparklineProjection {
        let values = numbers(from: envelopes)
        return SignalSparklineProjection(values: values, hasTrend: hasTrend(values))
    }
}
