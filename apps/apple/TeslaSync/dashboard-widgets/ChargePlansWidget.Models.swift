//
//  ChargePlansWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0018 · ChargePlansWidget (Apple)
//
//  Domain value types ported from the web source
//  (features/dashboard/widgets/ChargePlansWidget.tsx): the cached charge-plan +
//  rate-plan DTOs the state-holder seam delivers, the display-formatting context
//  (locale + time-zone + currency), the badge tone the status maps to, the
//  pre-formatted detail row (web `DetailEntry`), and the merged projection the
//  view renders. No SwiftUI / transport here — this is the deterministic core
//  iOS, iPadOS, macOS, and the web all agree on.
//

import Foundation

// MARK: - Cached DTO inputs (web `ChargePlan` / `RatePlanInfo`)

/// A single charge plan, faithful to the web `ChargePlan` interface
/// (`types/charging.ts`). Every field the widget reads is modeled `nil`-safe so
/// the adapter can reproduce the web's defensive reads (`target_soc ?? 0`,
/// `status ?? '—'`, `rate_plan ?? '—'`, the `estimated_kwh != null` guards). The
/// production source fills this from the shared `useChargePlans` state holder.
public struct ChargePlanInput: Sendable, Equatable, Identifiable {
    /// Stable plan id (web `ChargePlan.id`).
    public let id: Int64
    /// Lifecycle status (`active` / `scheduled` / `completed` / `failed` / …).
    public var status: String?
    /// Target state-of-charge percentage (web `target_soc`).
    public var targetSoc: Double?
    /// Departure deadline ISO timestamp (web `depart_by`).
    public var departBy: String?
    /// Scheduled charge-window start ISO timestamp (web `scheduled_start`).
    public var scheduledStart: String?
    /// Scheduled charge-window end ISO timestamp (web `scheduled_end`).
    public var scheduledEnd: String?
    /// Human rate-plan label (web `rate_plan`).
    public var ratePlan: String?
    /// Estimated energy for the plan in kWh (web `estimated_kwh`).
    public var estimatedKwh: Double?
    /// Estimated cost in the user's currency (web `estimated_cost`).
    public var estimatedCost: Double?
    /// Estimated savings vs. charging now (web `savings`).
    public var savings: Double?

    public init(
        id: Int64,
        status: String? = nil,
        targetSoc: Double? = nil,
        departBy: String? = nil,
        scheduledStart: String? = nil,
        scheduledEnd: String? = nil,
        ratePlan: String? = nil,
        estimatedKwh: Double? = nil,
        estimatedCost: Double? = nil,
        savings: Double? = nil
    ) {
        self.id = id
        self.status = status
        self.targetSoc = targetSoc
        self.departBy = departBy
        self.scheduledStart = scheduledStart
        self.scheduledEnd = scheduledEnd
        self.ratePlan = ratePlan
        self.estimatedKwh = estimatedKwh
        self.estimatedCost = estimatedCost
        self.savings = savings
    }
}

/// A utility rate plan, faithful to the web `RatePlanInfo` interface
/// (`id` / `name` / `utility`). The production source fills this from the shared
/// `useRatePlans` state holder.
public struct RatePlanInput: Sendable, Equatable, Identifiable {
    /// Rate-plan identifier — also the web rate-row badge text (`rp.id`).
    public let id: String
    /// Rate-plan display name (web `rp.name`).
    public var name: String?
    /// Issuing utility (web `rp.utility`) — the web rate-row label.
    public var utility: String?

    public init(id: String, name: String? = nil, utility: String? = nil) {
        self.id = id
        self.name = name
        self.utility = utility
    }
}

// MARK: - Display-formatting context (web useFormatting + useDateFormat)

/// The locale + time-zone + currency context the projection bakes into its
/// already-formatted strings, mirroring the web `useDateFormat` (`{ locale, tz }`)
/// and `useFormatting` (`{ currencySymbol, userPrecision }`) hooks. The
/// production source fills this from the shared settings store; previews / tests
/// pass it explicitly so the adapter is deterministic.
public struct ChargePlansFormatting: Sendable, Equatable {
    /// BCP-47 locale identifier for number + date rendering (web settings locale).
    public var localeIdentifier: String
    /// IANA time-zone identifier for date + time rendering (web `tz`).
    public var timeZoneIdentifier: String
    /// Currency symbol prefix (web `useFormatting().currencySymbol`, default "$").
    public var currencySymbol: String
    /// Currency fraction digits (web `useFormatting().userPrecision`, default 2).
    public var currencyPrecision: Int

    public init(
        localeIdentifier: String = "en_US",
        timeZoneIdentifier: String = "UTC",
        currencySymbol: String = "$",
        currencyPrecision: Int = 2
    ) {
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
        self.currencySymbol = currencySymbol
        self.currencyPrecision = currencyPrecision
    }

    /// US-English / UTC / `$` default used by previews and the empty model state.
    public static let `default` = ChargePlansFormatting()

    /// The resolved `Locale` for the number formatters.
    public var locale: Locale {
        Locale(identifier: localeIdentifier)
    }
}

// MARK: - Badge tone (web `detailBadgeVariant` / `badgeVariant`)

/// Semantic tone a plan status maps to, unifying the web's two parallel mappers
/// (`detailBadgeVariant` → success/warning/error/neutral and `badgeVariant` →
/// success/warning/danger/neutral; `WidgetDetailCard` folds `error` → `danger`,
/// so both resolve to the same visual tone). Kept SwiftUI-free here; the view
/// maps it to a `TSTone` at render time.
public enum ChargePlanTone: Sendable, Equatable {
    case success
    case warning
    case danger
    case neutral
}

/// A pre-localized chip carried by a detail row (web `DetailEntry.badge`).
public struct ChargePlanBadge: Sendable, Equatable {
    public var text: String
    public var tone: ChargePlanTone

    public init(text: String, tone: ChargePlanTone) {
        self.text = text
        self.tone = tone
    }
}

// MARK: - Detail row (web `DetailEntry`)

/// One label · value · optional-chip line, faithful to the web `DetailEntry`
/// (`label`, the pre-formatted `value`, an optional `badge`, and the `mono`
/// flag the rate rows set). `id` is a stable key for the SwiftUI list.
public struct ChargePlanDetailRow: Sendable, Equatable, Identifiable {
    public let id: String
    public var label: String
    public var value: String
    public var badge: ChargePlanBadge?
    public var mono: Bool

    public init(
        id: String,
        label: String,
        value: String,
        badge: ChargePlanBadge? = nil,
        mono: Bool = false
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.badge = badge
        self.mono = mono
    }
}

// MARK: - Active-plan projection (the web active-plan body)

/// The fully-formatted active plan — the soonest `active` / `scheduled` plan, or
/// the first plan (web `safePlans.find(...) ?? safePlans[0]`). Every string is
/// already display-ready so the SwiftUI layer performs no math or formatting.
public struct ActivePlanProjection: Sendable, Equatable {
    /// Raw status label for the header + first-row chip (web `status ?? '—'`).
    public var statusText: String
    /// Tone the status maps to (web `badgeVariant(status)`).
    public var statusTone: ChargePlanTone
    /// Header rate-plan caption (web `rate_plan ?? ''` — blank, not a dash).
    public var ratePlanHeaderText: String
    /// Target-SOC headline (web `${fmtInt(target_soc ?? 0)}%`) — stat tile + compact.
    public var targetSocText: String
    /// Departure stat-tile value (web `depart_by ? formatTime : '—'`).
    public var departureText: String
    /// Compact departure chip — `nil` when there is no `depart_by` (web guard).
    public var compactDepartureText: String?
    /// The full eight web `planEntries` (Target SOC, Departure, then the detail set).
    public var entries: [ChargePlanDetailRow]

    public init(
        statusText: String,
        statusTone: ChargePlanTone,
        ratePlanHeaderText: String,
        targetSocText: String,
        departureText: String,
        compactDepartureText: String?,
        entries: [ChargePlanDetailRow]
    ) {
        self.statusText = statusText
        self.statusTone = statusTone
        self.ratePlanHeaderText = ratePlanHeaderText
        self.targetSocText = targetSocText
        self.departureText = departureText
        self.compactDepartureText = compactDepartureText
        self.entries = entries
    }

    /// The web `planEntries.slice(2)` — the rows rendered in the detail card
    /// (Scheduled Start/End, Est. Energy/Cost, optional Savings, Rate Plan).
    public var detailEntries: [ChargePlanDetailRow] {
        Array(entries.dropFirst(2))
    }
}

// MARK: - Projection (the merged view-model the view switches over)

/// The fully-projected widget content — the single value the view renders (web
/// `activePlan` + the rate-plan rows + the `hasData` gate).
public struct ChargePlansProjection: Sendable, Equatable {
    /// The resolved active plan, or `nil` when there are no plans (web `null`).
    public var active: ActivePlanProjection?
    /// One row per utility rate plan (web `rateEntries`).
    public var rateRows: [ChargePlanDetailRow]
    /// Whether any charge plan resolved (web `safePlans.length > 0`).
    public var hasPlans: Bool

    public init(
        active: ActivePlanProjection?,
        rateRows: [ChargePlanDetailRow],
        hasPlans: Bool
    ) {
        self.active = active
        self.rateRows = rateRows
        self.hasPlans = hasPlans
    }

    /// Whether any rate plans resolved (web `safeRates.length > 0`).
    public var hasRates: Bool {
        !rateRows.isEmpty
    }

    /// Web `hasData = safePlans.length > 0 || safeRates.length > 0`.
    public var hasData: Bool {
        hasPlans || hasRates
    }

    /// The resolved-but-empty projection (web no plans + no rates).
    public static let empty = ChargePlansProjection(active: nil, rateRows: [], hasPlans: false)
}
