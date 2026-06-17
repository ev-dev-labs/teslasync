import SwiftUI

// MARK: - Parity string keys (Localizable.xcstrings)

/// Every visible literal the incident post-mortem page resolves, centralized so the views and the
/// parity tests agree on the key names. The web page (`IncidentTimelinePage.tsx`) holds its copy as
/// hardcoded English literals (its hooks are `useIncident` / `useAppendIncidentUpdate` /
/// `usePatchIncident` — no `t()` calls), so there are NO web i18n keys to port; ADR-014 still
/// requires every literal this native surface introduces to be externalized, so the copy is lifted
/// verbatim into new `incident.timeline.*` keys in `Localizable.xcstrings`.
///
/// The keys are computed (not stored) properties because `LocalizedStringKey` is not `Sendable`;
/// under the app's Swift 6 `complete` strict-concurrency mode a stored `static let` of it would be a
/// non-concurrency-safe global. Computed accessors hold no shared state, so they are safe. The
/// interpolated keys are exposed as pure `static func` formatters that resolve through
/// `String(localized:)` / `String(format:)` so the integer / string arguments are honored.
public enum IncidentTimelineStrings {
    // MARK: Page chrome

    public static var title: LocalizedStringKey { "incident.timeline.title" }
    public static var back: LocalizedStringKey { "incident.timeline.back" }
    public static var loading: LocalizedStringKey { "incident.timeline.loading" }

    // MARK: Not-found panel (web error / !incident branch — GlassPanel4)

    public static var notFoundSubtitle: LocalizedStringKey { "incident.timeline.notFound.subtitle" }
    public static var backToStatus: LocalizedStringKey { "incident.timeline.backToStatus" }

    // MARK: Header panel (GlassPanel1)

    public static var resolve: LocalizedStringKey { "incident.timeline.resolve" }

    // MARK: Timeline panel (GlassPanel2)

    public static var timelineHeading: LocalizedStringKey { "incident.timeline.timelineHeading" }
    public static var timelineEmpty: LocalizedStringKey { "incident.timeline.timelineEmpty" }

    // MARK: Append-update form (GlassPanel3)

    public static var addUpdate: LocalizedStringKey { "incident.timeline.addUpdate" }
    public static var adding: LocalizedStringKey { "incident.timeline.adding" }
    public static var messageHint: LocalizedStringKey { "incident.timeline.messageHint" }
    public static var messageLabel: LocalizedStringKey { "incident.timeline.messageLabel" }
    public static var statusAria: LocalizedStringKey { "incident.timeline.statusAria" }

    // MARK: Resolve confirm dialog (web ConfirmDialog)

    public static var confirmTitle: LocalizedStringKey { "incident.timeline.confirm.title" }
    public static var confirmMessage: LocalizedStringKey { "incident.timeline.confirm.message" }
    public static var confirmConfirm: LocalizedStringKey { "incident.timeline.confirm.confirm" }
    public static var confirmCancel: LocalizedStringKey { "incident.timeline.confirm.cancel" }

    // MARK: Status-change options (web append-form <Select>)

    public static var optionInvestigating: LocalizedStringKey { "incident.timeline.option.investigating" }
    public static var optionIdentified: LocalizedStringKey { "incident.timeline.option.identified" }
    public static var optionMonitoring: LocalizedStringKey { "incident.timeline.option.monitoring" }
    public static var optionResolved: LocalizedStringKey { "incident.timeline.option.resolved" }

    // MARK: Interpolated copy (resolved verbatim through the catalog)

    /// Web `Incident #${incident.id}` (PageContainer subtitle).
    public static func subtitle(id: Int64) -> String {
        String(format: String(localized: "incident.timeline.subtitle"), id)
    }

    /// Web "Incident {id} not found or you don't have access." (the `:id` is shown verbatim).
    public static func notFoundMessage(id: String) -> String {
        String(format: String(localized: "incident.timeline.notFound.message"), id)
    }

    /// Web "{n} entries" (the timeline header count).
    public static func entries(count: Int) -> String {
        String(format: String(localized: "incident.timeline.entries"), count)
    }

    /// Web "Affects: {a, b}" — the comma-joined affected components.
    public static func affects(components: String) -> String {
        String(format: String(localized: "incident.timeline.affects"), components)
    }

    /// Web "Started {date}".
    public static func started(date: String) -> String {
        String(format: String(localized: "incident.timeline.started"), date)
    }

    /// Web " · Resolved {date}" suffix (the leading separator is added by the caller).
    public static func resolvedAt(date: String) -> String {
        String(format: String(localized: "incident.timeline.resolvedAt"), date)
    }

    /// Web `Open · ${fmtDuration(started_at)}` badge.
    public static func openBadge(duration: String) -> String {
        String(format: String(localized: "incident.timeline.openBadge"), duration)
    }

    /// Web `Resolved · ${fmtDuration(started_at, resolved_at)}` badge.
    public static func resolvedBadge(duration: String) -> String {
        String(format: String(localized: "incident.timeline.resolvedBadge"), duration)
    }

    /// Web append-form first option "Keep status as {current label}".
    public static func keepStatus(current: String) -> String {
        String(format: String(localized: "incident.timeline.keepStatus"), current)
    }

    // MARK: Status / severity labels (web STATUS_LABEL + raw severity)

    /// The capitalized lifecycle label (web `STATUS_LABEL[status]`).
    public static func statusKey(_ status: IncidentStatus) -> LocalizedStringKey {
        switch status {
        case .investigating: "incident.timeline.status.investigating"
        case .identified: "incident.timeline.status.identified"
        case .monitoring: "incident.timeline.status.monitoring"
        case .resolved: "incident.timeline.status.resolved"
        }
    }

    /// The resolved capitalized lifecycle label as a plain string (interpolations / a11y).
    public static func statusLabel(_ status: IncidentStatus) -> String {
        switch status {
        case .investigating: String(localized: "incident.timeline.status.investigating")
        case .identified: String(localized: "incident.timeline.status.identified")
        case .monitoring: String(localized: "incident.timeline.status.monitoring")
        case .resolved: String(localized: "incident.timeline.status.resolved")
        }
    }

    /// The lowercase severity label (web `{incident.severity}`, CSS-uppercased at the display
    /// boundary).
    public static func severityKey(_ severity: IncidentSeverity) -> LocalizedStringKey {
        switch severity {
        case .minor: "incident.timeline.severity.minor"
        case .major: "incident.timeline.severity.major"
        case .critical: "incident.timeline.severity.critical"
        }
    }

    /// The resolved lowercase severity label as a plain string (a11y).
    public static func severityLabel(_ severity: IncidentSeverity) -> String {
        switch severity {
        case .minor: String(localized: "incident.timeline.severity.minor")
        case .major: String(localized: "incident.timeline.severity.major")
        case .critical: String(localized: "incident.timeline.severity.critical")
        }
    }

    // MARK: Toasts (web useToast success / error copy)

    public static var toastRequired: String { String(localized: "incident.timeline.toast.required") }
    public static var toastAdded: String { String(localized: "incident.timeline.toast.added") }
    public static var toastResolved: String { String(localized: "incident.timeline.toast.resolved") }
    public static var toastAppendFailed: String { String(localized: "incident.timeline.toast.appendFailed") }
    public static var toastResolveFailed: String { String(localized: "incident.timeline.toast.resolveFailed") }

    /// Every `incident.timeline.*` key this surface resolves, for the parity coverage test.
    public static let rawKeys: [String] = [
        "incident.timeline.addUpdate",
        "incident.timeline.adding",
        "incident.timeline.affects",
        "incident.timeline.back",
        "incident.timeline.backToStatus",
        "incident.timeline.confirm.cancel",
        "incident.timeline.confirm.confirm",
        "incident.timeline.confirm.message",
        "incident.timeline.confirm.title",
        "incident.timeline.entries",
        "incident.timeline.keepStatus",
        "incident.timeline.loading",
        "incident.timeline.messageLabel",
        "incident.timeline.messageHint",
        "incident.timeline.notFound.message",
        "incident.timeline.notFound.subtitle",
        "incident.timeline.openBadge",
        "incident.timeline.option.identified",
        "incident.timeline.option.investigating",
        "incident.timeline.option.monitoring",
        "incident.timeline.option.resolved",
        "incident.timeline.resolve",
        "incident.timeline.resolvedAt",
        "incident.timeline.resolvedBadge",
        "incident.timeline.severity.critical",
        "incident.timeline.severity.major",
        "incident.timeline.severity.minor",
        "incident.timeline.started",
        "incident.timeline.status.identified",
        "incident.timeline.status.investigating",
        "incident.timeline.status.monitoring",
        "incident.timeline.status.resolved",
        "incident.timeline.statusAria",
        "incident.timeline.subtitle",
        "incident.timeline.timelineEmpty",
        "incident.timeline.timelineHeading",
        "incident.timeline.title",
        "incident.timeline.toast.added",
        "incident.timeline.toast.appendFailed",
        "incident.timeline.toast.required",
        "incident.timeline.toast.resolveFailed",
        "incident.timeline.toast.resolved"
    ]
}
