//
//  WarrantyStatusWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0113 · WarrantyStatusWidget (Apple)
//
//  Projection assembly — the cached→projection adapter body, a faithful Swift port
//  of the `WarrantyStatusWidget.tsx` component body (the compact headline, the time
//  + mileage `MetricBar`s, and the `WidgetDetailCard` rows incl. coverage types).
//  Builds on the pure primitives in WarrantyStatusWidget.Builder.swift. No SwiftUI
//  / transport here — this is the unit-tested core both platforms agree on.
//

import Foundation

extension WarrantyProjectionBuilder {
    /// The derived warranty facts computed once from the untyped envelope, shared by
    /// the headline, the metric bars, and the detail entries (web's top-of-component
    /// `const` block).
    struct DerivedWarranty {
        let data: WarrantyDataInput
        let expiryDate: String?
        let daysRemaining: Int?
        let variant: WarrantyVariant
        let statusBadge: WarrantyBadge
        let mileageLimit: Double?
        let currentMileage: Double?
        let startDate: String?
    }

    // MARK: Projection (web component body)

    /// Builds the full projection from the untyped warranty envelope, faithful to
    /// the web `WarrantyStatusWidget` body. `data == nil` is the web
    /// `warrantyData === null` empty state.
    public static func build(
        data: WarrantyDataInput?,
        format: WarrantyFormatting,
        now: Date = Date()
    ) -> WarrantyProjection {
        guard let data else { return .empty }
        let derived = derive(data: data, now: now)
        return WarrantyProjection(
            hasData: true,
            daysRemaining: derived.daysRemaining,
            headlineText: headlineText(derived.daysRemaining, locale: format.localeIdentifier),
            statusVariant: derived.variant,
            statusBadge: derived.statusBadge,
            timeMetric: buildTimeMetric(derived: derived, format: format),
            mileageMetric: buildMileageMetric(derived: derived, format: format),
            entries: buildEntries(derived: derived, format: format, now: now)
        )
    }

    /// Computes the shared derived facts (web `expiryDate` / `daysRemaining` /
    /// `variant` / mileage cells / `startDate`).
    static func derive(data: WarrantyDataInput, now: Date) -> DerivedWarranty {
        let expiryDate = firstString(data, ["warranty_expiry_date", "expiry_date", "basic_expiry_date"])
        let daysRemaining = daysUntil(expiryDate, now: now)
        let variant = statusVariant(daysRemaining)
        let statusBadge: WarrantyBadge = (daysRemaining == nil || (daysRemaining ?? 0) <= 0)
            ? .expired
            : .active(variant)
        return DerivedWarranty(
            data: data,
            expiryDate: expiryDate,
            daysRemaining: daysRemaining,
            variant: variant,
            statusBadge: statusBadge,
            mileageLimit: firstNumber(data, ["mileage_limit_mi", "mileage_limit", "basic_mileage_limit_mi"]),
            currentMileage: firstNumber(data, ["current_mileage_mi", "odometer_mi", "current_odometer_mi"]),
            startDate: firstString(data, ["warranty_start_date", "start_date", "in_service_date"])
        )
    }

    /// Web compact headline `daysRemaining != null ? fmtInt(Math.max(daysRemaining, 0)) : '—'`.
    static func headlineText(_ daysRemaining: Int?, locale: String) -> String {
        guard let daysRemaining else { return "—" }
        return decimalString(Double(Swift.max(daysRemaining, 0)), fractionDigits: 0, locale: locale)
    }

    /// Web `totalDays` — `Math.ceil((end - start) / 86_400_000)` when both parse.
    static func totalWarrantyDays(start: String?, end: String?) -> Int? {
        guard let start, let end, let startDate = parseDate(start), let endDate = parseDate(end) else {
            return nil
        }
        let days = endDate.timeIntervalSince(startDate) / 86400.0
        guard days.isFinite else { return nil }
        return Int(days.rounded(.up))
    }

    // MARK: Metric bars (web `MetricBar`)

    /// Web time-remaining `MetricBar` (rendered only when `totalDays` + `daysUsed`
    /// are both known; `daysUsed` requires `daysRemaining`).
    static func buildTimeMetric(derived: DerivedWarranty, format: WarrantyFormatting) -> WarrantyMetric? {
        guard let totalDays = totalWarrantyDays(start: derived.startDate, end: derived.expiryDate),
              let daysRemaining = derived.daysRemaining
        else { return nil }
        let daysUsed = Swift.max(totalDays - daysRemaining, 0)
        return WarrantyMetric(
            label: WarrantyText("widget.warranty.timeRemaining", "Time Remaining"),
            fraction: fraction(value: Double(daysUsed), max: Double(totalDays)),
            valueText: decimalString(
                Double(Swift.max(daysRemaining, 0)),
                fractionDigits: 0,
                locale: format.localeIdentifier
            ),
            unit: .localized(WarrantyText("widget.warranty.daysUnit", "days")),
            variant: derived.variant
        )
    }

    /// Web mileage-remaining `MetricBar` (rendered only when both mileage cells are
    /// known). Colour comes from the raw `current / limit` ratio, the readout from
    /// the converted remaining distance.
    static func buildMileageMetric(derived: DerivedWarranty, format: WarrantyFormatting) -> WarrantyMetric? {
        guard let limit = derived.mileageLimit, let current = derived.currentMileage else { return nil }
        let unit = format.distanceUnit
        let ratio = current / limit
        let variant: WarrantyVariant = ratio > 0.9 ? .error : (ratio > 0.75 ? .warning : .success)
        return WarrantyMetric(
            label: WarrantyText("widget.warranty.mileageRemaining", "Mileage Remaining"),
            fraction: fraction(
                value: convertDistanceFromSI(current, to: unit),
                max: convertDistanceFromSI(limit, to: unit)
            ),
            valueText: decimalString(
                convertDistanceFromSI(limit - current, to: unit),
                fractionDigits: 0,
                locale: format.localeIdentifier
            ),
            unit: .symbol(unit),
            variant: variant
        )
    }

    // MARK: Detail entries (web `WidgetDetailCard` entries)

    /// Web detail rows: expiry + status, days remaining, mileage limit/current
    /// (when known), and one row per truthy coverage type.
    static func buildEntries(
        derived: DerivedWarranty,
        format: WarrantyFormatting,
        now: Date
    ) -> [WarrantyDetailEntry] {
        let locale = format.localeIdentifier
        var items: [WarrantyDetailEntry] = [
            WarrantyDetailEntry(
                id: "expiry",
                label: WarrantyText("widget.warranty.expiryDate", "Expiry Date"),
                value: derived.expiryDate != nil ? .text(dateMedium(derived.expiryDate, format: format)) : .none,
                badge: derived.statusBadge
            ),
            WarrantyDetailEntry(
                id: "daysRemaining",
                label: WarrantyText("widget.warranty.daysRemaining", "Days Remaining"),
                value: derived.daysRemaining != nil
                    ? .text(decimalString(
                        Double(Swift.max(derived.daysRemaining ?? 0, 0)),
                        fractionDigits: 0,
                        locale: locale
                    ))
                    : .none,
                mono: true
            )
        ]
        items += mileageEntries(derived: derived, format: format)
        items += coverageEntries(data: derived.data, format: format, now: now)
        return items
    }

    /// The mileage limit + current rows (web entries 3 + 4), present only when known.
    static func mileageEntries(derived: DerivedWarranty, format: WarrantyFormatting) -> [WarrantyDetailEntry] {
        let unit = format.distanceUnit
        let locale = format.localeIdentifier
        var rows: [WarrantyDetailEntry] = []
        if let limit = derived.mileageLimit {
            let text = decimalString(convertDistanceFromSI(limit, to: unit), fractionDigits: 0, locale: locale)
            rows.append(WarrantyDetailEntry(
                id: "mileageLimit",
                label: WarrantyText("widget.warranty.mileageLimit", "Mileage Limit"),
                value: .text("\(text) \(unit)"),
                mono: true
            ))
        }
        if let current = derived.currentMileage {
            let text = decimalString(convertDistanceFromSI(current, to: unit), fractionDigits: 0, locale: locale)
            rows.append(WarrantyDetailEntry(
                id: "currentMileage",
                label: WarrantyText("widget.warranty.currentMileage", "Current Mileage"),
                value: .text("\(text) \(unit)"),
                mono: true
            ))
        }
        return rows
    }

    /// One detail row per truthy coverage type (web `COVERAGE_TYPES` loop).
    static func coverageEntries(
        data: WarrantyDataInput,
        format: WarrantyFormatting,
        now: Date
    ) -> [WarrantyDetailEntry] {
        coverageTypes.compactMap { coverage in
            guard let raw = data.value(coverage.key), isTruthyCoverage(raw) else { return nil }
            let covExpiry = asString(data.value("\(coverage.key)_expiry_date"))
            let covDays = daysUntil(covExpiry, now: now)
            let covActive = covExpiry != nil ? (covDays != nil && (covDays ?? 0) > 0) : true
            let value: WarrantyDetailValue = covExpiry != nil
                ? .text(monthYear(covExpiry, format: format))
                : .localized(WarrantyText("widget.warranty.included", "Included"))
            return WarrantyDetailEntry(
                id: "coverage-\(coverage.key)",
                label: WarrantyText(coverage.labelKey, coverage.fallback),
                value: value,
                badge: covActive ? .covered : .expired
            )
        }
    }
}
