//
//  TeslaApiUsageCard.ViewModel.swift
//  TeslaSync — P4 feature view · 0257 · TeslaApiUsageCard (Apple)
//
//  The view-ready value types — the native mirrors of the shared web <UsageCard> section props
//  (components/data-display/UsageCard.tsx): the budget bar, the at-a-glance bands, the key/value
//  detail grid, the top-list breakdowns, the over-budget banner, and the footer links. Pure value
//  types (no SwiftUI, no Foundation beyond the standard library) so the `TeslaApiUsageProjection`
//  emits them and the unit tests assert them without rendering. Each is pre-localized +
//  pre-formatted so the view stays a pure function of the resolved state.
//

import Foundation

// MARK: - Budget bar (web `UsageCardBudget`)

/// The month-to-date budget progress bar — the native mirror of `UsageCardBudget`. `headline` is
/// the "spent of total" line; `rightLabel` the "% of monthly credit" caption; `caption` the
/// "Day N of M · resets …" line; `pct` (unclamped, 0…∞) drives both the bar width (clamped) and
/// the spoken value; `intent` colours the bar; `accessibilityLabel` names the budget for VoiceOver.
public struct TeslaApiUsageBudget: Sendable, Equatable {
    public let headline: String
    public let rightLabel: String
    public let caption: String
    public let pct: Double
    public let intent: TeslaApiUsageIntent
    public let accessibilityLabel: String

    public init(
        headline: String,
        rightLabel: String,
        caption: String,
        pct: Double,
        intent: TeslaApiUsageIntent,
        accessibilityLabel: String
    ) {
        self.headline = headline
        self.rightLabel = rightLabel
        self.caption = caption
        self.pct = pct
        self.intent = intent
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Band (web `UsageCardBand`)

/// One at-a-glance band — the native mirror of `UsageCardBand`. `value` is the locale-formatted
/// headline; `unit` is the small trailing unit label (`nil` for the currency forecast band); `sub`
/// is the subtitle line; `intent` drives the ring + tint; `systemImage` is the SF Symbol peer of
/// the web lucide icon (Activity / Clock / TrendingUp).
public struct TeslaApiUsageBand: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let unit: String?
    public let sub: String
    public let intent: TeslaApiUsageIntent
    public let systemImage: String

    public init(
        id: String,
        label: String,
        value: String,
        unit: String?,
        sub: String,
        intent: TeslaApiUsageIntent,
        systemImage: String
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.unit = unit
        self.sub = sub
        self.intent = intent
        self.systemImage = systemImage
    }
}

// MARK: - Detail (web `UsageCardDetail`)

/// One key/value detail cell — the native mirror of `UsageCardDetail`. `intent` colours the value
/// (web `intentValueText`); `suffix` is the optional muted trailing fragment (the error-rate cell's
/// `(errorCount)` parenthetical), rendered in a muted tone like the web `text-[var(--text-muted)]`.
public struct TeslaApiUsageDetail: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let suffix: String?
    public let intent: TeslaApiUsageIntent

    public init(
        id: String,
        label: String,
        value: String,
        suffix: String? = nil,
        intent: TeslaApiUsageIntent = .normal
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.suffix = suffix
        self.intent = intent
    }

    /// The combined spoken value — the headline plus the suffix when present.
    public var spokenValue: String {
        guard let suffix else { return value }
        return "\(value) \(suffix)"
    }
}

// MARK: - Top-list (web `UsageCardTopList` / `UsageCardTopListItem`)

/// One top-list row — the native mirror of `UsageCardTopListItem`. `label` renders monospaced;
/// `value` is the right-aligned count.
public struct TeslaApiUsageTopListItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String

    public init(id: String, label: String, value: String) {
        self.id = id
        self.label = label
        self.value = value
    }
}

/// One top-list block — the native mirror of `UsageCardTopList`. `systemImage` is the SF Symbol
/// peer of the web lucide icon (Zap / Activity).
public struct TeslaApiUsageTopList: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let systemImage: String
    public let items: [TeslaApiUsageTopListItem]

    public init(id: String, title: String, systemImage: String, items: [TeslaApiUsageTopListItem]) {
        self.id = id
        self.title = title
        self.systemImage = systemImage
        self.items = items
    }
}

// MARK: - Banner (web `UsageCardBanner`)

/// The optional over-budget callout — the native mirror of `UsageCardBanner`. Defaults to the
/// `danger` intent (web), with the AlertTriangle SF Symbol peer.
public struct TeslaApiUsageBanner: Equatable, Sendable {
    public let title: String
    public let description: String
    public let intent: TeslaApiUsageIntent
    public let systemImage: String

    public init(
        title: String,
        description: String,
        intent: TeslaApiUsageIntent = .danger,
        systemImage: String = "exclamationmark.triangle.fill"
    ) {
        self.title = title
        self.description = description
        self.intent = intent
        self.systemImage = systemImage
    }
}

// MARK: - Footer link (web `UsageCardFooterLink`)

/// One footer navigation link — the native mirror of `UsageCardFooterLink`. `route` is the web
/// `to` path (e.g. `/api-logs`); `primary` renders the filled variant. The card routes it through
/// the injected navigator seam rather than a web `<Link>`.
public struct TeslaApiUsageFooterLink: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let route: String
    public let primary: Bool

    public init(id: String, label: String, route: String, primary: Bool = false) {
        self.id = id
        self.label = label
        self.route = route
        self.primary = primary
    }
}
