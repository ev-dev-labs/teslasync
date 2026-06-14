//
//  ChargePlansWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0018 · ChargePlansWidget (Apple)
//
//  Pure formatters + projection builder — the unit-tested cached→projection
//  adapter, a faithful Swift port of the data pipeline in
//  features/dashboard/widgets/ChargePlansWidget.tsx (the active-plan selection,
//  the `badgeVariant` status→tone map, the eight `planEntries`, the rate-plan
//  rows, and the `fmtInt` / `fmtNumber` / `formatCurrency` / `formatTime` /
//  `formatDateShort` formatters). No SwiftUI / transport here — this is the
//  deterministic core iOS, iPadOS, macOS, and the web all agree on.
//

import Foundation

/// Resolves an i18n key to its localized string (web `t(key, default)`). Injected
/// so the adapter stays free of the SwiftUI localization facade and is testable
/// against the English fallbacks.
public typealias ChargePlansLocalize = (_ key: String, _ fallback: String) -> String

/// Pure adapters that merge the cached charge-plan + rate-plan DTOs into a
/// `ChargePlansProjection`. Mirrors the web source exactly so every platform
/// renders the same active plan, detail rows, and rate list.
public enum ChargePlansProjectionBuilder {
    /// The em dash the web uses for every missing value (`?? '—'`).
    static let placeholder = "—" // parity:allow ui
    /// Non-localized energy unit symbol — the web literal `kWh` (a unit, like `%`).
    static let energyUnitSymbol = "kWh"
    /// Non-localized percent symbol — the web literal `%`.
    static let percentSymbol = "%"

    // MARK: Status → tone (web `badgeVariant` / `detailBadgeVariant`)

    /// Maps a plan status to its chip tone. Faithful to the web `badgeVariant`
    /// (`completed`→success, `active`/`scheduled`→warning,
    /// `failed`/`cancelled`→danger, else neutral); a missing status is neutral.
    public static func tone(forStatus status: String?) -> ChargePlanTone {
        switch status {
        case "completed":
            .success
        case "active", "scheduled":
            .warning
        case "failed", "cancelled":
            .danger
        default:
            .neutral
        }
    }

    // MARK: Number formatting (web `fmtNumber` / `fmtInt`)

    /// Locale-grouped decimal with a fixed number of fraction digits — the web
    /// `fmtNumber(value, decimals)` (`toLocaleString` with min == max fraction
    /// digits). Ties round half away from zero to match the JS default.
    public static func decimal(_ value: Double, fractionDigits: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.roundingMode = .halfUp
        formatter.minimumFractionDigits = max(0, fractionDigits)
        formatter.maximumFractionDigits = max(0, fractionDigits)
        formatter.usesGroupingSeparator = true
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe))
            ?? String(format: "%.\(max(0, fractionDigits))f", safe)
    }

    /// Web `formatCurrency(amount)` — the currency symbol followed by the
    /// `userPrecision`-decimal grouped amount (`"$12.50"`).
    public static func currency(_ amount: Double, format: ChargePlansFormatting) -> String {
        let number = decimal(amount, fractionDigits: format.currencyPrecision, locale: format.locale)
        return "\(format.currencySymbol)\(number)"
    }

    // MARK: Date / time formatting (web `useDateFormat`)

    /// Parses the ISO-8601 (or date-only) string the web hands to `new Date(...)`.
    static func parseDate(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        let trimmed = iso.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }

        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = withFraction.date(from: trimmed) { return parsed }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let parsed = plain.date(from: trimmed) { return parsed }

        let dateOnly = DateFormatter()
        dateOnly.locale = Locale(identifier: "en_US_POSIX")
        dateOnly.timeZone = TimeZone(identifier: "UTC")
        dateOnly.dateFormat = "yyyy-MM-dd"
        return dateOnly.date(from: trimmed)
    }

    /// Web `formatTime(iso)` — short localized time (`{ hour, minute }`), `'—'`
    /// for null / invalid.
    static func timeText(_ iso: String?, format: ChargePlansFormatting) -> String {
        guard let date = parseDate(iso) else { return placeholder } // parity:allow ui
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: format.localeIdentifier)
        formatter.timeZone = TimeZone(identifier: format.timeZoneIdentifier) ?? .current
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Web `formatDateShort(iso)` — `{ month: 'short', day: 'numeric' }`, `'—'`
    /// for null / invalid.
    static func dateShortText(_ iso: String?, format: ChargePlansFormatting) -> String {
        guard let date = parseDate(iso) else { return placeholder } // parity:allow ui
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: format.localeIdentifier)
        formatter.timeZone = TimeZone(identifier: format.timeZoneIdentifier) ?? .current
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: date)
    }

    /// Web combined `${formatDateShort(iso)} ${formatTime(iso)}` for the
    /// scheduled-window rows.
    static func dateTimeText(_ iso: String?, format: ChargePlansFormatting) -> String {
        "\(dateShortText(iso, format: format)) \(timeText(iso, format: format))"
    }

    // MARK: Active-plan selection (web `safePlans.find(...) ?? safePlans[0]`)

    /// Web `activePlan` — the first `active` / `scheduled` plan, else the first
    /// plan, else `nil`.
    public static func selectActivePlan(_ plans: [ChargePlanInput]) -> ChargePlanInput? {
        plans.first { $0.status == "active" || $0.status == "scheduled" } ?? plans.first
    }

    // MARK: Plan entries (web `planEntries`)

    /// Builds the eight web `planEntries` for a plan: Target SOC + Departure
    /// (the stat tiles) followed by the detail-card rows (Scheduled Start/End,
    /// Est. Energy/Cost, the conditional Savings, and Rate Plan).
    static func planEntries(
        for plan: ChargePlanInput,
        format: ChargePlansFormatting,
        localize: ChargePlansLocalize
    ) -> [ChargePlanDetailRow] {
        let statusText = plan.status ?? placeholder // parity:allow ui
        let statusTone = tone(forStatus: plan.status)

        var items: [ChargePlanDetailRow] = []

        items.append(ChargePlanDetailRow(
            id: "targetSoc",
            label: localize("widget.chargePlans.targetSoc", "Target SOC"),
            value: targetSocText(for: plan, format: format),
            badge: ChargePlanBadge(text: statusText, tone: statusTone)
        ))

        items.append(ChargePlanDetailRow(
            id: "departure",
            label: localize("widget.chargePlans.departure", "Departure"),
            value: departureText(for: plan, format: format)
        ))

        items.append(ChargePlanDetailRow(
            id: "schedStart",
            label: localize("widget.chargePlans.schedStart", "Scheduled Start"),
            value: dateTimeText(plan.scheduledStart, format: format)
        ))

        items.append(ChargePlanDetailRow(
            id: "schedEnd",
            label: localize("widget.chargePlans.schedEnd", "Scheduled End"),
            value: dateTimeText(plan.scheduledEnd, format: format)
        ))

        items.append(ChargePlanDetailRow(
            id: "estEnergy",
            label: localize("widget.chargePlans.estEnergy", "Est. Energy"),
            value: energyText(for: plan, format: format)
        ))

        items.append(ChargePlanDetailRow(
            id: "estCost",
            label: localize("widget.chargePlans.estCost", "Est. Cost"),
            value: costText(for: plan, format: format)
        ))

        if let savings = savingsEntry(for: plan, format: format, localize: localize) {
            items.append(savings)
        }

        items.append(ChargePlanDetailRow(
            id: "ratePlan",
            label: localize("widget.chargePlans.ratePlan", "Rate Plan"),
            value: plan.ratePlan ?? placeholder // parity:allow ui
        ))

        return items
    }

    /// Web conditional Savings `planEntries` push — present only when
    /// `savings != null && savings > 0` (`formatCurrency(savings)` + a `saved` chip).
    static func savingsEntry(
        for plan: ChargePlanInput,
        format: ChargePlansFormatting,
        localize: ChargePlansLocalize
    ) -> ChargePlanDetailRow? {
        guard let savings = plan.savings, savings > 0 else { return nil }
        return ChargePlanDetailRow(
            id: "savings",
            label: localize("widget.chargePlans.savings", "Savings"),
            value: currency(savings, format: format),
            badge: ChargePlanBadge(text: localize("widget.chargePlans.saved", "saved"), tone: .success)
        )
    }

    /// Web `${fmtInt(target_soc ?? 0)}%`.
    static func targetSocText(for plan: ChargePlanInput, format: ChargePlansFormatting) -> String {
        "\(decimal(plan.targetSoc ?? 0, fractionDigits: 0, locale: format.locale))\(percentSymbol)"
    }

    /// Web `depart_by ? formatTime(depart_by) : '—'`.
    static func departureText(for plan: ChargePlanInput, format: ChargePlansFormatting) -> String {
        plan.departBy != nil ? timeText(plan.departBy, format: format) : placeholder // parity:allow ui
    }

    /// Web `estimated_kwh != null ? `${fmtNumber(estimated_kwh, 1)} kWh` : '—'`.
    static func energyText(for plan: ChargePlanInput, format: ChargePlansFormatting) -> String {
        guard let kwh = plan.estimatedKwh else { return placeholder } // parity:allow ui
        return "\(decimal(kwh, fractionDigits: 1, locale: format.locale)) \(energyUnitSymbol)"
    }

    /// Web `estimated_cost != null ? formatCurrency(estimated_cost) : '—'`.
    static func costText(for plan: ChargePlanInput, format: ChargePlansFormatting) -> String {
        guard let cost = plan.estimatedCost else { return placeholder } // parity:allow ui
        return currency(cost, format: format)
    }

    // MARK: Rate rows (web `rateEntries`)

    /// Builds one row per utility rate plan (web `rateEntries`): the utility as
    /// the label, the plan name as the value, the id as a neutral mono badge.
    static func rateRows(_ rates: [RatePlanInput]) -> [ChargePlanDetailRow] {
        rates.enumerated().map { index, rate in
            ChargePlanDetailRow(
                id: "rate-\(index)-\(rate.id)",
                label: rate.utility ?? placeholder, // parity:allow ui
                value: rate.name ?? placeholder, // parity:allow ui
                badge: ChargePlanBadge(
                    text: rate.id.isEmpty ? placeholder : rate.id, // parity:allow ui
                    tone: .neutral
                ),
                mono: true
            )
        }
    }

    // MARK: Projection

    /// Builds the full projection from the cached plan + rate DTOs, faithful to
    /// the web `ChargePlansWidget` body (active plan + rate rows + the data gate).
    public static func build(
        plans: [ChargePlanInput],
        rates: [RatePlanInput],
        format: ChargePlansFormatting,
        localize: ChargePlansLocalize
    ) -> ChargePlansProjection {
        let active = selectActivePlan(plans).map { plan -> ActivePlanProjection in
            let entries = planEntries(for: plan, format: format, localize: localize)
            return ActivePlanProjection(
                statusText: plan.status ?? placeholder, // parity:allow ui
                statusTone: tone(forStatus: plan.status),
                ratePlanHeaderText: plan.ratePlan ?? "",
                targetSocText: targetSocText(for: plan, format: format),
                departureText: departureText(for: plan, format: format),
                compactDepartureText: plan.departBy != nil ? timeText(plan.departBy, format: format) : nil,
                entries: entries
            )
        }

        return ChargePlansProjection(
            active: active,
            rateRows: rateRows(rates),
            hasPlans: !plans.isEmpty
        )
    }
}
