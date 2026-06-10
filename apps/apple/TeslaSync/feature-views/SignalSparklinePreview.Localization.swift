//
//  SignalSparklinePreview.Localization.swift
//  TeslaSync — P4 feature view · 0271 · SignalSparklinePreview (Apple)
//
//  The P1/S10 localization facade + the testable accessibility summaries. Both are
//  Foundation-only so the strings resolve through the per-surface catalog table (no
//  hardcoded literals in the view) and the VoiceOver content can be unit-tested
//  without rendering.
//
//  The web `SignalSparklinePreview` surfaces exactly two human strings — the "No
//  samples in last hour" trend fallback title and the "Non-numeric signal (kind)"
//  chip title. Native maps each to a stable dotted key carrying that exact English
//  value as its `NSLocalizedString` fallback, so the rendered copy is identical while
//  staying translatable. The remainder backs the native state envelope (loading /
//  error / retry / freshness) and the accessibility summaries.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "SignalSparklinePreview" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum SignalSparklineStrings {
    public static let table = "SignalSparklinePreview"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // --- Web-source strings (parity) ---

    /// Web `title="No samples in last hour"` on the "—" trend fallback.
    public static var noSamples: String {
        string("telemetry.signalSparkline.noSamples", "No samples in last hour")
    }

    /// Web `title={`Non-numeric signal (${valueKind})`}` on the kind chip. `token` is
    /// the protocol-level kind identifier (e.g. "string"), not localized prose.
    public static func nonNumericTitle(_ token: String) -> String {
        let template = string("telemetry.signalSparkline.nonNumeric", "Non-numeric signal (%@)")
        return String(format: template, token)
    }

    // --- Native state envelope ---

    public static var loadingLabel: String {
        string("telemetry.signalSparkline.loading", "Loading signal trend")
    }

    public static var errorTitle: String {
        string("telemetry.signalSparkline.errorTitle", "Couldn't load trend")
    }

    public static var retry: String {
        string("telemetry.signalSparkline.retry", "Retry")
    }

    // --- Freshness affordance (Live / Stale / Offline) ---

    public static var live: String {
        string("telemetry.signalSparkline.live", "Live")
    }

    public static var stale: String {
        string("telemetry.signalSparkline.stale", "Stale")
    }

    public static var offline: String {
        string("telemetry.signalSparkline.offline", "Offline")
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle,
/// exactly like the view's P1/S10 facade. A compact inline trend has no rich on-screen
/// chrome, so VoiceOver gets the meaning the sighted glance conveys.
public enum SignalSparklineAccessibility {
    /// The populated-trend summary: "{signal} trend, {n} samples in the last hour",
    /// with a trailing freshness clause when the stream is not live.
    public static func trendSummary(
        signal: String,
        sampleCount: Int,
        connection: SignalSparklineConnection,
        localize: (String, String) -> String
    ) -> String {
        let trend = localize("telemetry.signalSparkline.a11y.trend", "trend")
        let samples = localize("telemetry.signalSparkline.a11y.samples", "samples in the last hour")
        let base = "\(signal) \(trend), \(sampleCount) \(samples)"
        guard let freshness = freshnessClause(for: connection, localize: localize) else { return base }
        return "\(base), \(freshness)"
    }

    /// The no-samples summary (web "—" fallback): "{signal} trend, no samples in the
    /// last hour".
    public static func emptySummary(signal: String, localize: (String, String) -> String) -> String {
        let trend = localize("telemetry.signalSparkline.a11y.trend", "trend")
        let none = localize("telemetry.signalSparkline.a11y.noSamples", "no samples in the last hour")
        return "\(signal) \(trend), \(none)"
    }

    /// The non-numeric summary (web kind chip): "{signal}, non-numeric signal
    /// ({token})".
    public static func nonNumericSummary(
        signal: String,
        token: String,
        localize: (String, String) -> String
    ) -> String {
        let nonNumeric = localize("telemetry.signalSparkline.a11y.nonNumeric", "non-numeric signal")
        return "\(signal), \(nonNumeric) (\(token))"
    }

    /// The trailing freshness clause for the trend summary, or `nil` when live.
    static func freshnessClause(
        for connection: SignalSparklineConnection,
        localize: (String, String) -> String
    ) -> String? {
        switch connection {
        case .live:
            nil
        case .stale:
            localize("telemetry.signalSparkline.stale", "Stale")
        case .offline:
            localize("telemetry.signalSparkline.offline", "Offline")
        }
    }
}
