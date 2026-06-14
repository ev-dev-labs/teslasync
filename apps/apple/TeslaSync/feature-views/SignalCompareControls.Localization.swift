//
//  SignalCompareControls.Localization.swift
//  TeslaSync — P4 feature view · 0267 · SignalCompareControls (Apple)
//
//  The P1/S10 localization facade + the testable accessibility summaries. Both are
//  Foundation-only so the strings resolve through the per-surface catalog table (no
//  hardcoded literals in the view) and the VoiceOver content can be unit-tested
//  without rendering.
//
//  The web `SignalCompareControls` calls `t(key, default)` with the keys listed below;
//  native maps each to the same dotted key carrying that exact English value as its
//  `NSLocalizedString` fallback, so the rendered copy is identical while staying
//  translatable. Per-category / per-preset copy is resolved from the Core data's
//  `labelKey` + `defaultLabel` (web `t(c.labelKey, c.defaultLabel)`), so it is not
//  duplicated here.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views
/// hold no hardcoded literals. Keys live in the "SignalCompareControls" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; kept per-surface
/// so each parallel prompt owns its own strings.
public enum SignalCompareStrings {
    public static let table = "SignalCompareControls"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // --- Window labels (web `signalDiff.windowA` / `signalDiff.windowB`) ---

    public static var windowA: String {
        string("signalDiff.windowA", "Window A")
    }

    public static var windowB: String {
        string("signalDiff.windowB", "Window B")
    }

    // --- Presets + filter + clear (web parity) ---

    public static var presetsLabel: String {
        string("signalDiff.presetsLabel", "Quick presets:")
    }

    public static var filterPlaceholder: String { // parity:allow ui
        string("signalDiff.filterPlaceholder", "Filter signals…") // parity:allow ui
    }

    public static var clearCategory: String {
        string("signalDiff.clearCategory", "Clear")
    }

    // --- Help tooltips (web `HelpTooltip` body + aria) ---

    public static var snapshotHelp: String {
        string(
            "help.signal.snapshot",
            "A snapshot is a point-in-time view of every signal value at a single timestamp. "
                + "Falls back to signal_log within the last 30 days when the live layer doesn't have it."
        )
    }

    public static var snapshotHelpAria: String {
        string("help.signal.snapshot.aria", "More info about signal snapshots")
    }

    public static var diffHelp: String {
        string(
            "help.signal.diff",
            "Server-side comparison between two snapshots. Unchanged signals are omitted "
                + "from the result to reduce noise."
        )
    }

    public static var diffHelpAria: String {
        string("help.signal.diff.aria", "More info about signal diffs")
    }

    // --- Native state envelope (loading / empty / error / freshness) ---

    public static var surfaceTitle: String {
        string("signalDiff.compare.title", "Compare signals")
    }

    public static var clearSearch: String {
        string("signalDiff.compare.clearSearch", "Clear search")
    }

    public static var live: String {
        string("signalDiff.compare.live", "Live")
    }

    public static var stale: String {
        string("signalDiff.compare.stale", "Stale")
    }

    public static var offline: String {
        string("signalDiff.compare.offline", "Offline")
    }

    public static var staleBanner: String {
        string("signalDiff.compare.staleBanner", "Reconnecting — snapshot windows may be stale")
    }

    public static var offlineBanner: String {
        string("signalDiff.compare.offlineBanner", "Offline — showing the last loaded snapshots")
    }

    public static var loadingLabel: String {
        string("signalDiff.compare.loading", "Loading compare controls")
    }

    public static var errorTitle: String {
        string("signalDiff.compare.errorTitle", "Couldn't load signals")
    }

    public static var retry: String {
        string("signalDiff.compare.retry", "Retry")
    }

    public static var emptyTitle: String {
        string("signalDiff.compare.emptyTitle", "No signals to compare yet")
    }

    public static var emptyDescription: String {
        string(
            "signalDiff.compare.emptyDescription",
            "Signal snapshots will appear here once this vehicle streams telemetry. "
                + "Windows and presets stay ready."
        )
    }
}

// MARK: - Accessibility (VoiceOver summary)

/// Builds the surface's VoiceOver summary. Copy resolves through an injected localizer
/// so the summary is testable without a bundle, exactly like the views' P1/S10 facade.
public enum SignalCompareAccessibility {
    /// The compare-bar summary: the title plus how many signals are available to diff,
    /// and whether a category filter is active.
    public static func summary(
        availableCount: Int,
        category: SignalDiffCategory?,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("signalDiff.compare.title", "Compare signals")
        let signalsNoun = localize("signalDiff.compare.a11y.signals", "signals available")
        var summary = "\(title): \(availableCount) \(signalsNoun)"
        if let category {
            let filteredBy = localize("signalDiff.compare.a11y.filteredBy", "filtered by")
            let label = localize(category.labelKey, category.defaultLabel)
            summary += ", \(filteredBy) \(label)"
        }
        return summary
    }
}
