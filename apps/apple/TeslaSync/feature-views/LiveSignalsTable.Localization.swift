//
//  LiveSignalsTable.Localization.swift
//  TeslaSync — P4 feature view · 0036 · LiveSignalsTable (Apple)
//
//  The P1/S10 localization facade + the testable accessibility summary. Both are
//  Foundation-only so the strings resolve through the per-surface catalog table
//  (no hardcoded literals in the view) and the VoiceOver content can be unit
//  tested without rendering.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "LiveSignalsTable" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time. The
/// first block is the exact set extracted from the web source; the rest backs the
/// native-only chrome (freshness chip, retry, banners, accessibility).
public enum LiveSignalsTableStrings {
    public static let table = "LiveSignalsTable"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// --- Keys from the web source (parity) ---
    public static var columnName: String {
        string("admin.liveSignals.cols.name", "Signal")
    }

    public static var columnValue: String {
        string("admin.liveSignals.cols.value", "Value")
    }

    public static var columnTimestamp: String {
        string("admin.liveSignals.cols.timestamp", "Last update")
    }

    public static var filterPrompt: String {
        string("admin.liveSignals.filterPlaceholder", "Filter signal names…") // parity:allow web i18n key
    }

    public static var filterAria: String {
        string("admin.liveSignals.filterAria", "Filter signals")
    }

    public static var emptyTitle: String {
        string("admin.liveSignals.empty.title", "No live signals cached")
    }

    public static var emptyMessage: String {
        string(
            "admin.liveSignals.empty.message",
            "Redis has no live snapshot for this vehicle yet. Confirm the vehicle is online and publishing."
        )
    }

    public static var tableLoading: String {
        string("admin.liveSignals.table.loading", "Loading…")
    }

    public static var tableFiltered: String {
        string("admin.liveSignals.table.filtered", "No signals match this filter.")
    }

    /// --- Native chrome: states + actions ---
    public static var errorTitle: String {
        string("admin.liveSignals.error.title", "Couldn't load live signals")
    }

    public static var retry: String {
        string("admin.liveSignals.action.retry", "Retry")
    }

    public static var staleBanner: String {
        string("admin.liveSignals.banner.stale", "Reconnecting — values may be stale")
    }

    public static var offlineBanner: String {
        string("admin.liveSignals.banner.offline", "Offline — showing last known values")
    }

    /// --- Accessibility ---
    public static var tableLabel: String {
        string("admin.liveSignals.a11y.table", "Live signals")
    }

    public static var noTimestamp: String {
        string("admin.liveSignals.a11y.noTimestamp", "no timestamp")
    }

    public static var sortHint: String {
        string("admin.liveSignals.a11y.sortHint", "Sorts the table")
    }

    public static var sortedAscending: String {
        string("admin.liveSignals.a11y.sortedAscending", "sorted ascending")
    }

    public static var sortedDescending: String {
        string("admin.liveSignals.a11y.sortedDescending", "sorted descending")
    }

    /// VoiceOver value spoken for the whole table: the cached signal count.
    public static func countSummary(_ count: Int) -> String {
        String(format: string("admin.liveSignals.a11y.count", "%lld live signals"), count)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver content for the table + its rows. Pure + public so the
/// a11y content can be unit-tested without rendering the view.
public enum LiveSignalsTableAccessibility {
    /// The grid's spoken value — the cached row count, or the empty title when
    /// nothing is cached.
    public static func gridSummary(rowCount: Int) -> String {
        rowCount == 0 ? LiveSignalsTableStrings.emptyTitle : LiveSignalsTableStrings.countSummary(rowCount)
    }

    /// One row's combined VoiceOver label: name, value, and either the relative
    /// update time or the "no timestamp" fallback.
    public static func rowLabel(for row: LiveSignalRow, relative: String?) -> String {
        let when = relative ?? LiveSignalsTableStrings.noTimestamp
        return "\(row.name), \(row.valueText), \(when)"
    }
}
