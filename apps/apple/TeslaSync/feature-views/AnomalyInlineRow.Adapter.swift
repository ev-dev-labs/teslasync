//
//  AnomalyInlineRow.Adapter.swift
//  TeslaSync — P4 feature view · 0238 · AnomalyInlineRow (Apple)
//
//  The testable projection core for the anomaly inline-row surface — the faithful port
//  of features/system/components/status/AnomalyInlineRow.tsx and the `<HealthRow>` it
//  renders. Everything here is pure and dependency-free (Foundation only) so the whole
//  data → render decision can be unit-tested without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web component reads the first vehicle (`useVehicles()[0]`) as a sample, then
//      queries `/analytics/anomalies?vehicle_id={id}&days=1` and renders a single
//      `HealthRow` for the most-recent anomaly — or `return null` when there is no data,
//      `anomalies_last_24h === 0`, or no `anomalies[0]`.
//    • `SEVERITY_TO_STATUS` maps `critical → unhealthy`, `warning → degraded`,
//      `info → unknown`; `AnomalyHealthStatus(severity:)` reproduces it exactly.
//    • The summary is `${count} in 24h · ${signal} ${formatRelative(detected_at)}`;
//      `formatRelative` is the `s/m/h/d ago` ladder with the `recently` non-finite
//      fallback. Both are ported verbatim (`AnomalyInlineRowProjection.summary` +
//      `AnomalyRelativeTime`).
//    • The native surface widens the web "render nothing" branch into an explicit,
//      friendly `.empty` state (Apple surface contract: every state renders, never a
//      blank box). `webRendersRow(_:)` preserves — and unit-tests — the exact web
//      null decision so the two never drift.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable, non-identifying diagnostics slug emitted with the `view.opened` event,
/// in the dependency-free core so the projection's unit tests can reach it.
public enum AnomalyInlineRowSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "AnomalyInlineRow"

    /// Reports the surface becoming visible. Factored out so the open path is unit
    /// testable without a rendering host (the model calls this from `start()`).
    public static func reportOpen(to telemetry: any AnomalyInlineRowTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Severity + status (web `AnomalyEntry.severity` + `SEVERITY_TO_STATUS`)

/// The anomaly severity carried by an `AnomalyEntry` (web union
/// `'critical' | 'warning' | 'info'`).
public enum AnomalySeverity: String, CaseIterable, Sendable, Equatable {
    case critical
    case warning
    case info
}

/// The detector that produced an anomaly (web `AnomalyEntry.type`
/// `'z_score' | 'range' | 'trend'`). Carried for parity with the source shape even
/// though the inline row renders only the most-recent entry's severity + signal.
public enum AnomalyDetectorType: String, CaseIterable, Sendable, Equatable {
    case zScore = "z_score"
    case range
    case trend
}

/// The `HealthRow` status tone (web `HeroStatus`): drives the status dot + summary
/// tint. The inline row only ever resolves `unhealthy` / `degraded` / `unknown` from a
/// live anomaly, plus `healthy` for the friendly no-anomalies empty state; the full set
/// is modeled so the native `HealthRow` parity is complete.
public enum AnomalyHealthStatus: String, CaseIterable, Sendable, Equatable {
    case healthy
    case degraded
    case unhealthy
    case unknown
    case maintenance

    /// The web `SEVERITY_TO_STATUS` map: `critical → unhealthy`, `warning → degraded`,
    /// `info → unknown`.
    public init(severity: AnomalySeverity) {
        switch severity {
        case .critical: self = .unhealthy
        case .warning: self = .degraded
        case .info: self = .unknown
        }
    }

    /// VoiceOver descriptor key (table `AnomalyInlineRow`). Color alone is not an
    /// accessible signal, so the resolved status is also spoken as a word.
    public var accessibilityStatusKey: String {
        switch self {
        case .healthy: "anomaly.status.healthy"
        case .degraded: "anomaly.status.degraded"
        case .unhealthy: "anomaly.status.unhealthy"
        case .unknown: "anomaly.status.unknown"
        case .maintenance: "anomaly.status.maintenance"
        }
    }

    /// The English fallback for ``accessibilityStatusKey`` (web has no equivalent; this
    /// is native-only a11y chrome the surface contract requires).
    public var accessibilityStatusFallback: String {
        switch self {
        case .healthy: "Healthy"
        case .degraded: "Warning"
        case .unhealthy: "Critical"
        case .unknown: "Info"
        case .maintenance: "Maintenance"
        }
    }
}

// MARK: - Domain shape (web `AnomalyEntry` / `AnomalyData`)

/// One detected anomaly — the native parity of the web `AnomalyEntry`. `detectedAt` is
/// pre-parsed (`nil` when the source timestamp was unparseable, matching the web
/// `!Number.isFinite(Date.parse(iso))` branch that yields the `recently` fallback).
public struct AnomalyEntryItem: Sendable, Equatable {
    public let signal: String
    public let type: AnomalyDetectorType
    public let severity: AnomalySeverity
    public let value: Double
    public let baseline: Double
    public let zScore: Double
    public let detectedAt: Date?
    public let message: String

    public init(
        signal: String,
        type: AnomalyDetectorType,
        severity: AnomalySeverity,
        value: Double = 0,
        baseline: Double = 0,
        zScore: Double = 0,
        detectedAt: Date?,
        message: String = ""
    ) {
        self.signal = signal
        self.type = type
        self.severity = severity
        self.value = value
        self.baseline = baseline
        self.zScore = zScore
        self.detectedAt = detectedAt
        self.message = message
    }
}

/// The anomalies summary payload — the native parity of the web `AnomalyData`
/// (`/analytics/anomalies` response). The inline row reads `anomaliesLast24h` + the
/// first entry; the rest is modeled for parity with the source shape.
public struct AnomalyData: Sendable, Equatable {
    public let anomalies: [AnomalyEntryItem]
    public let healthSummary: [String: String]
    public let signalsMonitored: Int
    public let anomaliesLast7d: Int
    public let anomaliesLast24h: Int

    public init(
        anomalies: [AnomalyEntryItem],
        healthSummary: [String: String] = [:],
        signalsMonitored: Int = 0,
        anomaliesLast7d: Int = 0,
        anomaliesLast24h: Int
    ) {
        self.anomalies = anomalies
        self.healthSummary = healthSummary
        self.signalsMonitored = signalsMonitored
        self.anomaliesLast7d = anomaliesLast7d
        self.anomaliesLast24h = anomaliesLast24h
    }
}

// MARK: - Navigation target (web `to="/anomaly-detection"`)

/// The click-through destination of the inline row (web `<HealthRow to=…>`). The web
/// app routes to the dedicated `/anomaly-detection` page; there is no native `AppRoute`
/// case for it, so the surface emits this canonical path through an activation seam and
/// the host maps it — the view never navigates itself.
public struct AnomalyInlineRowDestination: Sendable, Equatable {
    /// The canonical web path, kept verbatim so the host's deep-link map stays aligned.
    public let path: String

    public init(path: String) {
        self.path = path
    }

    /// The anomaly-detection page (web `to="/anomaly-detection"`).
    public static let anomalyDetection = AnomalyInlineRowDestination(path: "/anomaly-detection")
}

// MARK: - Resolved content (web `HealthRow` inputs)

/// The fully-resolved inputs the content row renders — the native parity of the props
/// the web passes to `<HealthRow>`: the status tone, the label, the right-aligned
/// summary, and the click-through destination.
public struct AnomalyInlineRowContent: Sendable, Equatable {
    public let status: AnomalyHealthStatus
    public let signal: String
    public let count: Int
    public let relative: String
    public let summary: String
    public let destination: AnomalyInlineRowDestination

    public init(
        status: AnomalyHealthStatus,
        signal: String,
        count: Int,
        relative: String,
        summary: String,
        destination: AnomalyInlineRowDestination = .anomalyDetection
    ) {
        self.status = status
        self.signal = signal
        self.count = count
        self.relative = relative
        self.summary = summary
        self.destination = destination
    }
}

/// The bound source's load status for the anomalies query (web `useQuery` loading /
/// resolved / failure).
public enum AnomalyInlineRowLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// What the surface renders at the top level. The web has exactly two outcomes — a
/// `HealthRow` or `null` — widened here with the loading + error + friendly-empty
/// envelopes so no state is ever a blank box (Apple surface contract).
public enum AnomalyInlineRowPhase: Sendable, Equatable {
    case loading
    case content(AnomalyInlineRowContent)
    case empty
    case error(String)
}

// MARK: - Relative time (web `formatRelative`)

/// Formats an anomaly's `detected_at` as a coarse "time ago" — the faithful port of the
/// web `formatRelative`: seconds, then minutes, hours, days, each floored; a `nil`
/// (unparseable) timestamp yields the `recently` fallback (web non-finite branch). The
/// `n` magnitude is interpolated into a P1/S10 template so no English literal lives in
/// code.
public enum AnomalyRelativeTime {
    public static func relative(
        from detectedAt: Date?,
        now: Date,
        localize: (String, String) -> String
    ) -> String {
        guard let detectedAt else {
            return localize("anomaly.relative.recently", "recently")
        }
        let seconds = Swift.max(0, Int(now.timeIntervalSince(detectedAt).rounded(.down)))
        if seconds < 60 {
            return token("anomaly.relative.seconds", "{{n}}s ago", seconds, localize)
        }
        if seconds < 3600 {
            return token("anomaly.relative.minutes", "{{n}}m ago", seconds / 60, localize)
        }
        if seconds < 86400 {
            return token("anomaly.relative.hours", "{{n}}h ago", seconds / 3600, localize)
        }
        return token("anomaly.relative.days", "{{n}}d ago", seconds / 86400, localize)
    }

    private static func token(
        _ key: String,
        _ fallback: String,
        _ magnitude: Int,
        _ localize: (String, String) -> String
    ) -> String {
        localize(key, fallback).replacingOccurrences(of: "{{n}}", with: String(magnitude))
    }
}

// MARK: - Projection core (pure)

/// The dependency-free resolution from the bound source's load status + the anomalies
/// payload to the top-level render phase + the resolved content row.
public enum AnomalyInlineRowProjection {
    /// Whether the web component would render its `HealthRow` for this payload — the
    /// faithful port of `if (!data || data.anomalies_last_24h === 0) return null` plus
    /// `if (!top) return null`. Cached so the parity with the web null decision is
    /// explicit and unit-tested; the view shows a friendly empty state where the web
    /// renders nothing.
    public static func webRendersRow(_ data: AnomalyData?) -> Bool {
        guard let data, data.anomaliesLast24h != 0 else { return false }
        return data.anomalies.first != nil
    }

    /// Builds the resolved `HealthRow` content from a payload, or `nil` when the web
    /// would render nothing (no 24h anomalies / no first entry).
    public static func content(
        from data: AnomalyData,
        now: Date,
        localize: (String, String) -> String
    ) -> AnomalyInlineRowContent? {
        guard data.anomaliesLast24h != 0, let top = data.anomalies.first else { return nil }
        let relative = AnomalyRelativeTime.relative(from: top.detectedAt, now: now, localize: localize)
        return AnomalyInlineRowContent(
            status: AnomalyHealthStatus(severity: top.severity),
            signal: top.signal,
            count: data.anomaliesLast24h,
            relative: relative,
            summary: summary(count: data.anomaliesLast24h, signal: top.signal, relative: relative, localize: localize),
            destination: .anomalyDetection
        )
    }

    /// Resolves the render phase. A renderable payload always wins (so a cached row
    /// survives a refresh / failure, freshness shown by the chip and the failure
    /// surfaced by the embedder); otherwise loading shows before the first payload, a
    /// resolved-but-dormant payload shows the friendly empty state, and a failure with
    /// no cached row shows the error state.
    public static func resolvePhase(
        status: AnomalyInlineRowLoadStatus,
        data: AnomalyData?,
        now: Date,
        localize: (String, String) -> String
    ) -> AnomalyInlineRowPhase {
        let resolved = data.flatMap { content(from: $0, now: now, localize: localize) }
        switch status {
        case .loading:
            return resolved.map(AnomalyInlineRowPhase.content) ?? .loading
        case .loaded:
            return resolved.map(AnomalyInlineRowPhase.content) ?? .empty
        case let .failed(message):
            return resolved.map(AnomalyInlineRowPhase.content) ?? .error(message)
        }
    }

    /// The right-aligned summary (web
    /// ``${count} in 24h · ${signal} ${formatRelative(detected_at)}``). The count is the
    /// raw integer + the signal a product proper noun (both verbatim, web template
    /// literal); the surrounding copy + the `·` separator resolve through the localizer.
    public static func summary(
        count: Int,
        signal: String,
        relative: String,
        localize: (String, String) -> String
    ) -> String {
        localize("anomaly.summary", "{{count}} in 24h · {{signal}} {{relative}}")
            .replacingOccurrences(of: "{{count}}", with: String(count))
            .replacingOccurrences(of: "{{signal}}", with: signal)
            .replacingOccurrences(of: "{{relative}}", with: relative)
    }
}

// MARK: - Accessibility (VoiceOver)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// so the labels are testable without a bundle.
public enum AnomalyInlineRowAccessibility {
    /// The content row's VoiceOver label — the web `aria-label={`${label} — ${summary}`}`.
    public static func rowLabel(summary: String, localize: (String, String) -> String) -> String {
        "\(localize("anomaly.row.label", "Anomalies")) — \(summary)"
    }

    /// The empty-state VoiceOver label (native-only friendly state).
    public static func emptyLabel(localize: (String, String) -> String) -> String {
        let label = localize("anomaly.row.label", "Anomalies")
        let message = localize("anomaly.empty", "No anomalies in the last 24h")
        return "\(label) — \(message)"
    }
}
