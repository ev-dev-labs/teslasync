//
//  EntriesTable.Strings.swift
//  TeslaSync — P4 feature view · 0027 · EntriesTable (Apple)
//
//  The P1/S10 localization facade + the testable accessibility seam for the EntriesTable
//  surface. Foundation-only so both can be exercised by the adapter unit tests without
//  rendering the SwiftUI view.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the per-surface "EntriesTable" table (folded into
/// the app `Localizable.xcstrings` catalog at integration time); the non-empty `value:`
/// fallback means the English copy renders even before that merge. `string` is
/// Foundation-only so the adapter's accessibility summary can reuse it.
public enum EntriesTableStrings {
    public static let table = "EntriesTable"

    /// Stable key constants — the exact keys extracted from the web source plus the
    /// native-chrome keys, kept here so tests can assert the namespace.
    public enum Key {
        public static let colArrived = "admin.dlq.cols.arrived"
        public static let colReason = "admin.dlq.cols.reason"
        public static let colVin = "admin.dlq.cols.vin"
        public static let colTopic = "admin.dlq.cols.topic"
        public static let colRedeliveries = "admin.dlq.cols.redeliveries"
        public static let colSize = "admin.dlq.cols.size"
        public static let colReplayable = "admin.dlq.cols.replayable"
        public static let colActions = "admin.dlq.cols.actions"
        public static let commonYes = "common.yes"
        public static let commonNo = "common.no"
        public static let inspect = "admin.dlq.actions.inspect"
        public static let tableLoading = "admin.dlq.table.loading"
        public static let tableEmpty = "admin.dlq.table.empty"
        public static let tableTitle = "admin.dlq.table.title"
        public static let errorTitle = "admin.dlq.table.errorTitle"
        public static let offlineBanner = "admin.dlq.table.offlineBanner"
        public static let staleBanner = "admin.dlq.table.staleBanner"
        public static let retry = "admin.dlq.actions.retry"
        public static let freshnessLive = "admin.dlq.freshness.live"
        public static let freshnessStale = "admin.dlq.freshness.stale"
        public static let freshnessOffline = "admin.dlq.freshness.offline"
        public static let a11yInspect = "admin.dlq.a11y.inspect"
        public static let a11yCount = "admin.dlq.a11y.count"
        public static let a11yRefresh = "admin.dlq.a11y.refresh"

        /// Every key the surface resolves, for the namespacing contract test.
        public static let all = [
            colArrived, colReason, colVin, colTopic, colRedeliveries, colSize, colReplayable,
            colActions, commonYes, commonNo, inspect, tableLoading, tableEmpty, tableTitle,
            errorTitle, offlineBanner, staleBanner, retry, freshnessLive, freshnessStale,
            freshnessOffline, a11yInspect, a11yCount, a11yRefresh
        ]
    }

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func format(_ key: String, _ fallbackFormat: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallbackFormat), arguments: args)
    }

    /// Resolved accessors (web `t(key, default)`), one per user-facing string.
    static var colArrived: String {
        string(Key.colArrived, "Arrived")
    }

    static var colReason: String {
        string(Key.colReason, "Reason")
    }

    static var colVin: String {
        string(Key.colVin, "VIN")
    }

    static var colTopic: String {
        string(Key.colTopic, "Source topic")
    }

    static var colRedeliveries: String {
        string(Key.colRedeliveries, "Redel.")
    }

    static var colSize: String {
        string(Key.colSize, "Payload")
    }

    static var colReplayable: String {
        string(Key.colReplayable, "Replayable")
    }

    static var colActions: String {
        string(Key.colActions, "Actions")
    }

    static var commonYes: String {
        string(Key.commonYes, "Yes")
    }

    static var commonNo: String {
        string(Key.commonNo, "No")
    }

    static var inspect: String {
        string(Key.inspect, "Inspect")
    }

    static var tableLoading: String {
        string(Key.tableLoading, "Loading…")
    }

    static var tableEmpty: String {
        string(Key.tableEmpty, "No DLQ entries — the pipeline is clean.")
    }

    static var tableTitle: String {
        string(Key.tableTitle, "Dead-letter queue")
    }

    static var errorTitle: String {
        string(Key.errorTitle, "Couldn't load DLQ entries")
    }

    static var offlineBanner: String {
        string(Key.offlineBanner, "Offline — showing last known entries")
    }

    static var staleBanner: String {
        string(Key.staleBanner, "Reconnecting — entries may be stale")
    }

    static var retry: String {
        string(Key.retry, "Retry")
    }

    static var freshnessLive: String {
        string(Key.freshnessLive, "Live")
    }

    static var freshnessStale: String {
        string(Key.freshnessStale, "Stale")
    }

    static var freshnessOffline: String {
        string(Key.freshnessOffline, "Offline")
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver labels for the table and its rows. Pure + public so the spoken
/// content can be unit-tested without rendering the view.
public enum EntriesTableAccessibility {
    /// One spoken sentence describing a row, e.g.
    /// "Arrived Jun 7, 2026 at 12:00, Reason codec_drop, VIN 5YJ…, Source topic …,
    /// Redel. 3, Payload 1.2 KB, Replayable Yes".
    public static func rowLabel(for row: DLQEntryRow) -> String {
        var parts: [String] = [
            "\(EntriesTableStrings.colArrived) \(row.arrivedAtText)",
            "\(EntriesTableStrings.colReason) \(row.reasonDisplay)",
            "\(EntriesTableStrings.colVin) \(row.vinDisplay)",
            "\(EntriesTableStrings.colTopic) \(row.sourceTopicDisplay)",
            "\(EntriesTableStrings.colRedeliveries) \(row.redeliveriesText)",
            "\(EntriesTableStrings.colSize) \(row.payloadSizeText)"
        ]
        let replayable = row.replayable ? EntriesTableStrings.commonYes : EntriesTableStrings.commonNo
        parts.append("\(EntriesTableStrings.colReplayable) \(replayable)")
        return parts.joined(separator: ", ")
    }

    /// The Inspect button's spoken label, e.g. "Inspect entry 42".
    public static func inspectLabel(for row: DLQEntryRow) -> String {
        EntriesTableStrings.format(EntriesTableStrings.Key.a11yInspect, "Inspect entry %lld", row.id)
    }

    /// The table container summary, e.g. "Dead-letter queue, 7 entries".
    public static func listSummary(count: Int) -> String {
        let title = EntriesTableStrings.tableTitle
        let entries = EntriesTableStrings.format(EntriesTableStrings.Key.a11yCount, "%lld entries", count)
        return "\(title), \(entries)"
    }
}
