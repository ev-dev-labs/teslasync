//
//  SuperchargerHistoryWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0098 · SuperchargerHistoryWidget (Apple)
//
//  The pure, SwiftUI-free, Shared-free adapter layer: the cached DTO inputs the
//  state holder pushes (`SuperchargerSession` + `SuperchargerSummary`) and the
//  projection that turns them into the view's render model — the ranked sessions
//  list (label / energy / cost badge) and the 30-day totals + compact spend hero.
//
//  This is a 1:1 port of the web source's `rankedItems` `useMemo`, the totals
//  derivation, and the compact branch in
//  `features/dashboard/widgets/SuperchargerHistoryWidget.tsx`, composed with the
//  `useUnits().formatEnergy` (SI watt-hours → user energy unit, precision 1) and
//  `useFormatting().formatCurrency` ("$" + 2-decimal grouped) formatters it uses.
//  Kept free of SwiftUI + the KMP `Shared` framework so the adapter is
//  unit-testable on the host without rendering or the Kotlin/Native toolchain.
//

import Foundation

// MARK: - Cached DTO inputs (port of the web `TeslaChargingHistoryEntry` / `…Summary`)

/// One Supercharger / DC billing record — the native projection of a single web
/// `TeslaChargingHistoryEntry` (`@/api/hooks/useCharging`). Only the five fields
/// the widget reads (`id`, `site_location_name`, `charge_start_datetime`,
/// `usage_wh`, `total_due`) are modeled; the billing/invoice metadata is out of
/// scope for this surface.
public struct SuperchargerSession: Sendable, Equatable, Identifiable {
    public let id: Int64
    public var siteName: String?
    public var startedAt: Date?
    public var usageWh: Double?
    public var totalDue: Double?

    public init(
        id: Int64,
        siteName: String? = nil,
        startedAt: Date? = nil,
        usageWh: Double? = nil,
        totalDue: Double? = nil
    ) {
        self.id = id
        self.siteName = siteName
        self.startedAt = startedAt
        self.usageWh = usageWh
        self.totalDue = totalDue
    }
}

/// The rolling 30-day totals — the native projection of the web
/// `TeslaChargingHistorySummary`. Drives the totals row and the compact spend
/// hero. Only the two members the widget reads (`total_wh`, `total_spend`) are
/// modeled.
public struct SuperchargerSummary: Sendable, Equatable {
    public var totalWh: Double?
    public var totalSpend: Double?

    public init(totalWh: Double? = nil, totalSpend: Double? = nil) {
        self.totalWh = totalWh
        self.totalSpend = totalSpend
    }
}

// MARK: - Energy unit preference (port of web `EnergyUnitPref`)

/// The user's energy display unit, mirroring the web `EnergyUnitPref`
/// (`'Wh' | 'kWh'`). Carries the SI divisor so the projection math agrees with
/// `convertEnergyFromSI` exactly. The web `useUnits()` default is `kWh`
/// (`DEFAULT_ENERGY_PREF`), which this enum mirrors for unknown labels.
public enum SuperchargerEnergyUnit: String, Sendable, Equatable, CaseIterable {
    case wattHours = "Wh"
    case kilowattHours = "kWh"

    /// Resolves a stored preference label (`"Wh"` / `"kWh"`) to a unit,
    /// defaulting to kilowatt-hours — the web `DEFAULT_ENERGY_PREF`.
    public static func fromLabel(_ label: String?) -> SuperchargerEnergyUnit {
        guard let label else { return .kilowattHours }
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        return SuperchargerEnergyUnit(rawValue: trimmed) ?? .kilowattHours
    }

    /// Watt-hours per one unit — the divisor in `wh / whPerUnit`
    /// (`convertEnergyFromSI`: `Wh` → ÷1, `kWh` → ÷1000).
    public var whPerUnit: Double {
        switch self {
        case .wattHours: 1
        case .kilowattHours: 1000
        }
    }

    /// The unit symbol appended to formatted values (`Wh` / `kWh`).
    public var symbol: String {
        rawValue
    }
}

// MARK: - Format options (the user display preferences the projection bakes in)

/// The display preferences the projection bakes into its already-formatted
/// strings: the energy unit (`useUnits`), the currency symbol + precision
/// (`useFormatting`), and the locale + per-field precision. Defaults mirror the
/// web globals (`kWh`, `"$"`, 2-decimal currency, 1-decimal energy, `en-US`) so
/// previews and tests are deterministic; the production source passes the live
/// settings through.
public struct SuperchargerFormatOptions: Sendable, Equatable {
    public var energyUnit: SuperchargerEnergyUnit
    public var energyPrecision: Int
    public var currencySymbol: String
    public var currencyPrecision: Int
    public var localeIdentifier: String

    public init(
        energyUnit: SuperchargerEnergyUnit = .kilowattHours,
        energyPrecision: Int = 1,
        currencySymbol: String = "$",
        currencyPrecision: Int = 2,
        localeIdentifier: String = "en-US"
    ) {
        self.energyUnit = energyUnit
        self.energyPrecision = energyPrecision
        self.currencySymbol = currencySymbol
        self.currencyPrecision = currencyPrecision
        self.localeIdentifier = localeIdentifier
    }

    var locale: Locale {
        Locale(identifier: localeIdentifier)
    }
}

// MARK: - Formatters (ports of lib/unitConversion.formatEnergy + useFormatting.formatCurrency)

/// Pure, locale-aware number/energy/currency formatting mirroring the web
/// `formatNumber` (`toLocaleString` with fixed fraction digits + grouping),
/// `formatEnergy` (SI Wh → user unit + symbol) and `formatCurrency`
/// (`symbol` + `fmtNumber`). Ties round half away from zero to match the JS
/// default, exactly like the sibling number-format ports.
public enum SuperchargerHistoryFormat {
    /// Locale-grouped decimal with a fixed number of fraction digits.
    public static func decimal(
        _ value: Double,
        fractionDigits: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
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

    /// Formats SI watt-hours in the user's energy unit with the unit symbol —
    /// the web `formatEnergy(wh, { precision })` ("42.6 kWh").
    public static func energy(_ wh: Double, options: SuperchargerFormatOptions) -> String {
        let value = (wh.isFinite ? wh : 0) / options.energyUnit.whPerUnit
        let number = decimal(value, fractionDigits: options.energyPrecision, locale: options.locale)
        return "\(number) \(options.energyUnit.symbol)"
    }

    /// Formats a currency amount with the user's symbol — the web
    /// `formatCurrency(amount)` ("$12.50").
    public static func currency(_ amount: Double, options: SuperchargerFormatOptions) -> String {
        let number = decimal(amount, fractionDigits: options.currencyPrecision, locale: options.locale)
        return "\(options.currencySymbol)\(number)"
    }
}

// MARK: - Ranked session (port of the web `RankedItem`)

/// One row of the sessions ranked list — the native `RankedItem`. Already
/// formatted for display (`formattedValue` = "42.6 kWh", `badge` = "$12.50"),
/// with the raw `value` (watt-hours) retained so the list can size its relative
/// background bars.
public struct SuperchargerRankedItem: Sendable, Equatable, Identifiable {
    public let id: Int64
    public var label: String
    public var value: Double
    public var formattedValue: String
    public var badge: String?

    public init(id: Int64, label: String, value: Double, formattedValue: String, badge: String?) {
        self.id = id
        self.label = label
        self.value = value
        self.formattedValue = formattedValue
        self.badge = badge
    }
}

// MARK: - Projection (the adapter output the view renders)

/// The fully-computed render model the view switches over. Every value is
/// already formatted into display strings so the SwiftUI layer performs no math
/// or formatting — only layout. This is the output the adapter tests assert for
/// parity with the web computation.
public struct SuperchargerHistoryProjection: Sendable, Equatable {
    public var items: [SuperchargerRankedItem]
    public var totalEnergyText: String
    public var totalSpendText: String
    public var compactSpendText: String
    public var currencyUnit: String

    public init(
        items: [SuperchargerRankedItem],
        totalEnergyText: String,
        totalSpendText: String,
        compactSpendText: String,
        currencyUnit: String
    ) {
        self.items = items
        self.totalEnergyText = totalEnergyText
        self.totalSpendText = totalSpendText
        self.compactSpendText = compactSpendText
        self.currencyUnit = currencyUnit
    }

    /// Whether there is at least one session to show — the web
    /// `entries.length > 0` switch.
    public var hasSessions: Bool {
        !items.isEmpty
    }

    /// The largest watt-hours value among the visible rows, used to size the
    /// relative background bars (web `Math.max(...values)`).
    public var maxValue: Double {
        items.map(\.value).max() ?? 0
    }
}

// MARK: - Adapter (cached DTOs → projection)

/// Pure transforms from the cached DTOs to the render model. The state holder
/// calls these; the view never recomputes them.
public enum SuperchargerHistoryAdapter {
    /// The em-dash sentinel the web shows for a missing site name (`?? '—'`).
    static let dash = "—"

    /// The number of sessions the list renders — the web `.slice(0, 10)` /
    /// `maxItems={10}` cap.
    public static let maxItems = 10

    /// Projects the cached sessions + summary into the render model: the
    /// top-`maxItems` rows sorted by start time descending (web sort + slice),
    /// the 30-day totals, and the compact spend hero.
    public static func project(
        sessions: [SuperchargerSession],
        summary: SuperchargerSummary?,
        options: SuperchargerFormatOptions = SuperchargerFormatOptions()
    ) -> SuperchargerHistoryProjection {
        let ranked = sessions
            .sorted { ($0.startedAt ?? .distantPast) > ($1.startedAt ?? .distantPast) }
            .prefix(maxItems)
            .map { session -> SuperchargerRankedItem in
                let wh = session.usageWh ?? 0
                let cost = session.totalDue ?? 0
                return SuperchargerRankedItem(
                    id: session.id,
                    label: session.siteName ?? dash,
                    value: wh,
                    formattedValue: SuperchargerHistoryFormat.energy(wh, options: options),
                    badge: cost > 0 ? SuperchargerHistoryFormat.currency(cost, options: options) : nil
                )
            }

        let totalWh = summary?.totalWh ?? 0
        let totalSpend = summary?.totalSpend ?? 0

        return SuperchargerHistoryProjection(
            items: Array(ranked),
            totalEnergyText: SuperchargerHistoryFormat.energy(totalWh, options: options),
            totalSpendText: SuperchargerHistoryFormat.currency(totalSpend, options: options),
            compactSpendText: SuperchargerHistoryFormat.decimal(
                totalSpend,
                fractionDigits: options.currencyPrecision,
                locale: options.locale
            ),
            currencyUnit: options.currencySymbol
        )
    }
}
