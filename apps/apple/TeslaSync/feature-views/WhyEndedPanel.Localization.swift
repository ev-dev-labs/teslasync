//
//  WhyEndedPanel.Localization.swift
//  TeslaSync — P4 feature view · 0152 · WhyEndedPanel (Apple)
//
//  The P1/S10 localization facade for the "Why did this drive end?" panel. Pure +
//  Foundation-only so every string resolves through the per-surface catalog table
//  ("WhyEndedPanel", folded into the app `Localizable.xcstrings` at integration
//  time) with the web `t(key, default)` English fallback — the view holds no
//  hardcoded literals.
//
//  The first block is the exact set of keys extracted from the web source
//  (WhyEndedPanel.tsx). The second backs the native-only chrome (freshness chip,
//  connectivity banner, loading, pagination, accessibility) the Apple HIG states
//  contract requires.
//

import Foundation

public enum WhyEndedPanelStrings {
    public static let table = "WhyEndedPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: Keys from the web source (parity)

    public static var title: String {
        string("driveDetail.whyEnded.title", "Why did this drive end?")
    }

    public static var windowAria: String {
        string("driveDetail.whyEnded.windowAria", "Diagnostic window")
    }

    /// The localized label for a window option (web
    /// `t('driveDetail.whyEnded.windowOption.{w}', w)` — the value falls back to
    /// the window literal itself).
    public static func windowOption(_ window: DriveDiagnosticWindow) -> String {
        string("driveDetail.whyEnded.windowOption.\(window.rawValue)", window.rawValue)
    }

    public static var fsmTitle: String {
        string("driveDetail.whyEnded.fsmTitle", "FSM transitions")
    }

    public static var signalTitle: String {
        string("driveDetail.whyEnded.signalTitle", "Signal window")
    }

    public static var columnTimestamp: String {
        string("driveDetail.whyEnded.signal.cols.ts", "Timestamp")
    }

    public static var columnField: String {
        string("driveDetail.whyEnded.signal.cols.field", "Field")
    }

    public static var columnValue: String {
        string("driveDetail.whyEnded.signal.cols.value", "Value")
    }

    public static var errorTitle: String {
        string("driveDetail.whyEnded.error.title", "Could not load diagnostic")
    }

    public static var errorMessage: String {
        string("driveDetail.whyEnded.error.message", "Try a different window or reload the page.")
    }

    public static var retry: String {
        string("common.retry", "Retry")
    }

    public static var fsmEmptyTitle: String {
        string("driveDetail.whyEnded.fsmEmpty.title", "No transitions in window")
    }

    public static var fsmEmptyMessage: String {
        string(
            "driveDetail.whyEnded.fsmEmpty.message",
            "No FSM state changes recorded near the drive end. Try a wider window."
        )
    }

    /// The i18next template `trigger: {{trigger}}` — the `{{trigger}}` token is
    /// substituted by `WhyEndedPanelFormat.interpolateTrigger`.
    public static var triggerTemplate: String {
        string("driveDetail.whyEnded.trigger", "trigger: {{trigger}}")
    }

    public static var signalEmpty: String {
        string("driveDetail.whyEnded.signalEmpty", "No signals in this window for the default whitelist.")
    }

    // MARK: Native chrome — disclosure + freshness + connectivity

    public static var expandedState: String {
        string("driveDetail.whyEnded.a11y.expanded", "expanded")
    }

    public static var collapsedState: String {
        string("driveDetail.whyEnded.a11y.collapsed", "collapsed")
    }

    public static var toggleHint: String {
        string("driveDetail.whyEnded.a11y.toggleHint", "Shows the drive-end diagnostic")
    }

    public static var live: String {
        string("driveDetail.whyEnded.live", "Live")
    }

    public static var stale: String {
        string("driveDetail.whyEnded.stale", "Stale")
    }

    public static var offline: String {
        string("driveDetail.whyEnded.offline", "Offline")
    }

    public static var staleBanner: String {
        string("driveDetail.whyEnded.staleBanner", "Reconnecting — diagnostic data may be stale")
    }

    public static var offlineBanner: String {
        string("driveDetail.whyEnded.offlineBanner", "Offline — showing the last loaded diagnostic")
    }

    // MARK: Native chrome — states + pagination + accessibility

    public static var loadingA11y: String {
        string("driveDetail.whyEnded.loadingA11y", "Loading drive-end diagnostic")
    }

    public static var rowsPerPage: String {
        string("driveDetail.whyEnded.pagination.rowsPerPage", "Rows per page")
    }

    public static var previousPage: String {
        string("driveDetail.whyEnded.pagination.previous", "Previous page")
    }

    public static var nextPage: String {
        string("driveDetail.whyEnded.pagination.next", "Next page")
    }

    /// The "Page {{page}} of {{count}}" pager readout — both tokens substituted.
    public static func pageStatus(page: Int, count: Int) -> String {
        let template = string("driveDetail.whyEnded.pagination.status", "Page {{page}} of {{count}}")
        return template
            .replacingOccurrences(of: "{{page}}", with: String(page))
            .replacingOccurrences(of: "{{count}}", with: String(count))
    }

    public static var fsmSectionA11y: String {
        string("driveDetail.whyEnded.a11y.fsmSection", "FSM transitions")
    }

    public static var signalSectionA11y: String {
        string("driveDetail.whyEnded.a11y.signalSection", "Signal window")
    }

    public static var signalCountFormat: String {
        string("driveDetail.whyEnded.a11y.signalCount", "%lld signals")
    }
}
