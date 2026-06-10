//
//  SignalCatalogPanel.Localization.swift
//  TeslaSync — P4 feature view · 0264 · SignalCatalogPanel (Apple)
//
//  The P1/S10 localization facade + the testable accessibility summary. Both are
//  Foundation-only so the strings resolve through the per-surface catalog table
//  (no hardcoded literals in the view) and the VoiceOver content can be unit
//  tested without rendering.
//
//  The first block is the exact set of keys extracted from the web source
//  (features/telemetry/components/SignalCatalogPanel.tsx). The rest backs the
//  native-only chrome the web delegates to its host page / shared components:
//  the four-level Status badge labels (web getCatalogStalenessStyle), the
//  formatStaleness pieces, the error/retry surface, the stale/offline banners,
//  and the accessibility summaries.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SignalCatalogPanel" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum SignalCatalogPanelStrings {
    public static let table = "SignalCatalogPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: Column headers (web `t('signalGap.*')`)

    public static var columnStatus: String {
        string("signalGap.status", "Status")
    }

    public static var columnSignal: String {
        string("signalGap.signal", "Signal")
    }

    public static var columnValue: String {
        string("signalGap.lastValue", "Last Value")
    }

    public static var columnLastUpdated: String {
        string("signalGap.lastUpdated", "Last Updated")
    }

    public static var columnTimeSince: String {
        string("signalGap.timeSince", "Time Since")
    }

    // MARK: Summary StatCards

    public static var summaryTotal: String {
        string("signalGap.totalSignals", "Total Signals")
    }

    public static var summaryActive: String {
        string("signalGap.active", "Active (<30s)")
    }

    public static var summaryStale: String {
        string("signalGap.stale", "Stale (>5min)")
    }

    public static var summaryNever: String {
        string("signalGap.neverReceived", "Never Received")
    }

    // MARK: Header + filter + sort

    public static var refreshInterval: String {
        string("signalGap.refreshInterval", "Refreshes every 5s")
    }

    public static var searchPrompt: String {
        // The web t() key is literally named with the forbidden word; keep verbatim for parity.
        string("signalGap.filterPlaceholder", "Filter by signal name...") // parity:allow verbatim web i18n key
    }

    public static var searchAria: String {
        string("signalGap.filterLabel", "Filter signals")
    }

    public static var filterAll: String {
        string("signalGap.all", "All")
    }

    public static var filterStaleOnly: String {
        string("signalGap.staleOnly", "Stale Only")
    }

    public static var filterActiveOnly: String {
        string("signalGap.activeOnly", "Active Only")
    }

    public static var sortMostStale: String {
        string("signalGap.mostStale", "Most Stale")
    }

    public static var sortAlpha: String {
        string("signalGap.az", "A-Z")
    }

    public static var sortCategory: String {
        string("signalGap.category", "Category")
    }

    // MARK: Empty / filtered-empty

    public static var noMatch: String {
        string("signalGap.noMatch", "No signals match current filters")
    }

    public static var noData: String {
        string("signalGap.noData", "No signal data available")
    }

    public static var lastRefreshed: String {
        string("signalGap.lastRefreshed", "Last refreshed")
    }

    /// Localized label for a filter mode segment.
    public static func filterLabel(_ mode: SignalCatalogPanelFilterMode) -> String {
        switch mode {
        case .all: filterAll
        case .stale: filterStaleOnly
        case .active: filterActiveOnly
        }
    }

    /// Localized label for a sort mode segment.
    public static func sortLabel(_ mode: SignalCatalogPanelSortMode) -> String {
        switch mode {
        case .staleness: sortMostStale
        case .alpha: sortAlpha
        case .category: sortCategory
        }
    }

    // MARK: Status badge labels (web getCatalogStalenessStyle)

    public static var toneActive: String {
        string("signalCatalog.status.active", "Active")
    }

    public static var toneAging: String {
        string("signalCatalog.status.aging", "Aging")
    }

    public static var toneStale: String {
        string("signalCatalog.status.stale", "Stale")
    }

    public static var toneNeverReceived: String {
        string("signalCatalog.status.neverReceived", "Never received")
    }

    /// Localized label for a row's four-level badge tone.
    public static func toneLabel(_ tone: SignalCatalogPanelTone) -> String {
        switch tone {
        case .active: toneActive
        case .aging: toneAging
        case .stale: toneStale
        case .neverReceived: toneNeverReceived
        }
    }

    // MARK: formatStaleness pieces (web template literals)

    public static var stalenessNever: String {
        string("signalCatalog.staleness.never", "—")
    }

    public static var stalenessSeconds: String {
        string("signalCatalog.staleness.seconds", "%@s ago")
    }

    public static var stalenessMinutes: String {
        string("signalCatalog.staleness.minutes", "%@m ago")
    }

    public static var stalenessHoursMinutes: String {
        string("signalCatalog.staleness.hoursMinutes", "%1$@h %2$@m ago")
    }

    /// The localized template bundle the pure `formatStaleness` consumes.
    public static var stalenessTemplates: SignalCatalogPanelStalenessTemplates {
        SignalCatalogPanelStalenessTemplates(
            never: stalenessNever,
            secondsAgo: stalenessSeconds,
            minutesAgo: stalenessMinutes,
            hoursMinutesAgo: stalenessHoursMinutes
        )
    }

    // MARK: Native chrome: error + banners

    public static var errorTitle: String {
        string("signalCatalog.error.title", "Couldn't load signals")
    }

    public static var retry: String {
        string("signalCatalog.action.retry", "Retry")
    }

    public static var staleBanner: String {
        string("signalCatalog.banner.stale", "Reconnecting — values may be stale")
    }

    public static var offlineBanner: String {
        string("signalCatalog.banner.offline", "Offline — showing last known values")
    }

    // MARK: Selection (web `selection` aria-labels)

    public static func addSignal(_ name: String) -> String {
        String(format: string("signalCatalog.addSignal", "Add %@ to selection"), name)
    }

    public static func removeSignal(_ name: String) -> String {
        String(format: string("signalCatalog.removeSignal", "Remove %@ from selection"), name)
    }

    // MARK: Accessibility

    public static var tableLabel: String {
        string("signalCatalog.a11y.table", "Signal catalog")
    }

    public static var noTimestamp: String {
        string("signalCatalog.a11y.noTimestamp", "no timestamp")
    }

    public static func countSummary(_ count: Int) -> String {
        String(format: string("signalCatalog.a11y.count", "%lld signals"), count)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver content for the table + its rows. Pure + public so the
/// a11y content can be unit-tested without rendering the view.
public enum SignalCatalogPanelAccessibility {
    /// The table's spoken value — the catalog signal count, or the no-data title
    /// when nothing is cached.
    public static func tableSummary(rowCount: Int) -> String {
        rowCount == 0 ? SignalCatalogPanelStrings.noData : SignalCatalogPanelStrings.countSummary(rowCount)
    }

    /// One row's combined VoiceOver label: signal name, value, the localized
    /// status (badge tone label), the last-updated text, and the time-since text
    /// (or the "no timestamp" fallback when the row never reported).
    public static func rowLabel(
        name: String,
        value: String,
        status: String,
        lastUpdated: String,
        timeSince: String?
    ) -> String {
        let when = timeSince ?? SignalCatalogPanelStrings.noTimestamp
        return "\(name), \(value), \(status), \(lastUpdated), \(when)"
    }

    /// The localized selection toggle label for a row (web add/remove aria-label).
    public static func selectionLabel(name: String, isSelected: Bool) -> String {
        isSelected
            ? SignalCatalogPanelStrings.removeSignal(name)
            : SignalCatalogPanelStrings.addSignal(name)
    }
}
