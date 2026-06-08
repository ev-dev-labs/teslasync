//
//  SessionDetailPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0091 · SessionDetailPanel (Apple)
//
//  The testable projection core for the Session Details surface — the SwiftUI parity of
//  features/charging/components/charging-curve/SessionDetailPanel.tsx plus the helpers.ts
//  `getChargerLabel` / `durationMinutes` and the numberFormat / dateFormat / useFormatting
//  pipeline it renders through. Everything here is pure + Foundation-only (no store, no
//  rendered view) so the charger derivation, the duration math, the row assembly with its
//  conditional rows, the value formatting, and the VoiceOver summaries are all unit tested
//  in isolation and produce the exact same numbers the web surface shows.
//

import Foundation

// MARK: - Charger kind (web `getChargerLabel`)

/// The three charger classes the web `getChargerLabel` resolves. The raw value is the
/// i18n key suffix and `labelFallback` is the web English default the helper returns
/// verbatim — routed through the P1/S10 facade here so the native view holds no literal.
public enum SessionDetailPanelChargerKind: String, Sendable, Equatable, CaseIterable {
    case supercharger
    case dcFast
    case homeAc

    /// The label i18n key.
    public var labelKey: String {
        switch self {
        case .supercharger: "charging.curve.charger.supercharger"
        case .dcFast: "charging.curve.charger.dcFast"
        case .homeAc: "charging.curve.charger.homeAc"
        }
    }

    /// The English fallback (web `getChargerLabel` return value).
    public var labelFallback: String {
        switch self {
        case .supercharger: "Supercharger"
        case .dcFast: "DC Fast"
        case .homeAc: "Home / AC"
        }
    }
}

// MARK: - Session snapshot (web `ChargingSession` subset)

/// The subset of the `ChargingSession` row the surface reads, modeled in SI canonical
/// units exactly as the API serialises them (web `@/api/types` `ChargingSession`): energy
/// in watt-hours, power in watts, SOC in percent, timestamps as instants. The production
/// source projects these from the shared charging state holder; tests build values directly.
public struct ChargingSessionSnapshot: Sendable, Equatable {
    public let startedAt: Date
    public let endedAt: Date?
    public let startSocPct: Double
    public let endSocPct: Double?
    public let totalEnergyAddedWh: Double
    public let peakPowerW: Double?
    public let avgPowerW: Double?
    public let costDecimal: Double?
    public let startPlace: String?
    public let chargerType: String?

    public init(
        startedAt: Date,
        endedAt: Date? = nil,
        startSocPct: Double,
        endSocPct: Double? = nil,
        totalEnergyAddedWh: Double,
        peakPowerW: Double? = nil,
        avgPowerW: Double? = nil,
        costDecimal: Double? = nil,
        startPlace: String? = nil,
        chargerType: String? = nil
    ) {
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.totalEnergyAddedWh = totalEnergyAddedWh
        self.peakPowerW = peakPowerW
        self.avgPowerW = avgPowerW
        self.costDecimal = costDecimal
        self.startPlace = startPlace
        self.chargerType = chargerType
    }
}

// MARK: - Formatting context (web `useFormatting` + global precision/locale)

/// The user's display-formatting context, mirroring the web `useFormatting` result plus
/// the `numberFormat` global precision/locale: the currency symbol + decimal precision the
/// cost uses, the BCP-47 locale the grouped numbers use, and an optional IANA zone the
/// date renders in (web `formatDateTime` converts the UTC instant to the user's zone).
public struct SessionFormatting: Sendable, Equatable {
    public var currencySymbol: String
    public var precision: Int
    public var localeIdentifier: String
    public var timeZoneIdentifier: String?

    public init(
        currencySymbol: String = "$",
        precision: Int = 2,
        localeIdentifier: String = "en_US",
        timeZoneIdentifier: String? = nil
    ) {
        self.currencySymbol = currencySymbol
        self.precision = precision
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
    }
}

// MARK: - Detail row (web `SessionDetailRow`)

/// One label/value line — the native parity of the web `SessionDetailRow`. `value` is the
/// fully formatted display string; the label is carried as an i18n key + English fallback
/// so the view resolves it through the P1/S10 facade. `id` is the label key (each row's
/// label is unique within the panel) so the list identity is collision-free.
public struct SessionDetailRow: Identifiable, Equatable, Sendable {
    public let labelKey: String
    public let labelFallback: String
    public let value: String

    public var id: String {
        labelKey
    }

    public init(labelKey: String, labelFallback: String, value: String) {
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
    }
}

// MARK: - Render phase (native states contract)

/// The mutually-exclusive render branches the surface switches over. The web leaf always
/// renders the rows from its `session` prop; the native surface adds the loading / error /
/// empty chrome the Apple HIG states contract requires so a missing session is never a
/// blank box.
public enum SessionDetailPhase: Sendable, Equatable {
    case loading
    case error(String)
    case empty
    case data
}

// MARK: - Projection (port of the web render + helpers.ts)

/// Pure projection from a session snapshot to view-ready rows — the native port of the web
/// component's render body and the `getChargerLabel` / `durationMinutes` helpers plus the
/// `fmtWithUnit` / `formatDateTime` / `formatCurrency` formatting. Unit tested across every
/// branch and conditional row.
public enum SessionDetailProjection {
    /// The DC-class power threshold (web `peak_power_w > 20_000`).
    static let dcPowerThresholdW: Double = 20000

    private static let energyUnit = "kWh"
    private static let powerUnit = "kW"
    private static let durationUnit = "min"
    private static let socArrow = "→"
    private static let socUnknown = "?"

    /// Derives the charger class — a faithful port of web `getChargerLabel`: a `charger_type`
    /// equal to (or containing) "tesla" is a Supercharger; any other non-empty `charger_type`
    /// is DC Fast; an absent type with peak power over the DC threshold is DC Fast; otherwise
    /// Home / AC. An empty-string type is falsy in the web source, so it falls through to the
    /// power check exactly as it does here.
    public static func chargerKind(for session: ChargingSessionSnapshot) -> SessionDetailPanelChargerKind {
        if let type = session.chargerType {
            if type == "Tesla" || type.lowercased().contains("tesla") {
                return .supercharger
            }
            if !type.isEmpty {
                return .dcFast
            }
        }
        if let peak = session.peakPowerW, peak > dcPowerThresholdW {
            return .dcFast
        }
        return .homeAc
    }

    /// The localized charger label (web `getChargerLabel`), resolved through the P1/S10 facade.
    public static func chargerLabel(for session: ChargingSessionSnapshot) -> String {
        let kind = chargerKind(for: session)
        return SessionDetailStrings.string(kind.labelKey, kind.labelFallback)
    }

    /// Whole-minute duration between the two instants — a faithful port of web
    /// `durationMinutes`: no end (or a non-positive / non-finite span) yields 0, otherwise the
    /// span is rounded to the nearest minute.
    public static func durationMinutes(startedAt: Date, endedAt: Date?) -> Int {
        guard let endedAt else { return 0 }
        let seconds = endedAt.timeIntervalSince(startedAt)
        guard seconds.isFinite, seconds > 0 else { return 0 }
        return Int((seconds / 60).rounded())
    }

    /// The SOC range string (web `` `${start}% → ${end ?? '?'}%` ``). A missing end SOC renders
    /// the web "?" marker.
    public static func socString(start: Double, end: Double?) -> String {
        let startText = plainNumber(start)
        let endText = end.map(plainNumber) ?? socUnknown
        return "\(startText)% \(socArrow) \(endText)%"
    }

    /// Builds the ordered rows for a session — the native parity of the web render body,
    /// including the same conditional rows (Avg Power only when present, Cost only when
    /// present, Location only when a non-empty place is present).
    public static func rows(
        for session: ChargingSessionSnapshot,
        formatting: SessionFormatting
    ) -> [SessionDetailRow] {
        let energy = unitValue(session.totalEnergyAddedWh / 1000, unit: energyUnit, formatting: formatting)
        let peak = unitValue((session.peakPowerW ?? 0) / 1000, unit: powerUnit, formatting: formatting)
        let minutes = durationMinutes(startedAt: session.startedAt, endedAt: session.endedAt)
        let duration = unitValue(Double(minutes), unit: durationUnit, formatting: formatting)

        var rows: [SessionDetailRow] = [
            row("charging.curve.date", "Date", dateString(session.startedAt, formatting: formatting)),
            row("charging.curve.chargerType", "Charger Type", chargerLabel(for: session)),
            row("charging.curve.socRange", "SOC Range", socString(start: session.startSocPct, end: session.endSocPct)),
            row("charging.curve.energyAdded", "Energy Added", energy),
            row("charging.curve.peakPower", "Peak Power", peak)
        ]
        if let avgPowerW = session.avgPowerW {
            let avg = unitValue(avgPowerW / 1000, unit: powerUnit, formatting: formatting)
            rows.append(row("charging.curve.avgPower", "Avg Power", avg))
        }
        rows.append(row("charging.curve.duration", "Duration", duration))
        if let costDecimal = session.costDecimal {
            rows.append(row("charging.curve.cost_decimal", "Cost", currency(costDecimal, formatting: formatting)))
        }
        if let place = session.startPlace, !place.isEmpty {
            rows.append(row("charging.curve.location", "Location", place))
        }
        return rows
    }

    /// Compact row constructor used by `rows(for:formatting:)`.
    private static func row(_ labelKey: String, _ labelFallback: String, _ value: String) -> SessionDetailRow {
        SessionDetailRow(labelKey: labelKey, labelFallback: labelFallback, value: value)
    }

    /// Resolves the render phase from the source load status (web `isLoading` / failure /
    /// resolved) and whether a session is present.
    public static func resolvePhase(_ status: SessionDetailLoadStatus, hasSession: Bool) -> SessionDetailPhase {
        switch status {
        case .loading: .loading
        case let .failed(message): .error(message)
        case .empty: .empty
        case .loaded: hasSession ? .data : .empty
        }
    }

    // MARK: - Value formatting (port of numberFormat.ts / dateFormat.ts / useFormatting)

    /// `fmtWithUnit(value, unit)` — the grouped number at the user precision, a space, the unit.
    static func unitValue(_ value: Double, unit: String, formatting: SessionFormatting) -> String {
        "\(number(value, formatting: formatting)) \(unit)"
    }

    /// `formatCurrency(amount)` — `currencySymbol + fmtNumber(amount, precision)`.
    static func currency(_ amount: Double, formatting: SessionFormatting) -> String {
        formatting.currencySymbol + number(amount, formatting: formatting)
    }

    /// `fmtNumber(value, precision, locale)` — fixed fraction digits, grouped, half-up; a
    /// non-finite input collapses to 0 (web `safeNumber`).
    static func number(_ value: Double, formatting: SessionFormatting) -> String {
        let digits = max(0, formatting.precision)
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: formatting.localeIdentifier)
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(digits)f", safe)
    }

    /// `formatDateTime(iso)` — the instant rendered in the user's locale + zone as a medium
    /// date with a short time (web "Apr 4, 2026, 2:30 AM").
    static func dateString(_ date: Date, formatting: SessionFormatting) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: formatting.localeIdentifier)
        if let identifier = formatting.timeZoneIdentifier, let zone = TimeZone(identifier: identifier) {
            formatter.timeZone = zone
        }
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// JavaScript `` `${number}` `` parity for the SOC components: an integral value renders
    /// without a fraction, otherwise the un-grouped decimal is kept verbatim.
    static func plainNumber(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        if value.rounded() == value, abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the detail rows. Pure + public so the spoken content is
/// asserted without rendering the view.
public enum SessionDetailAccessibility {
    /// A single row's spoken label, e.g. "Energy Added, 42.57 kWh".
    public static func rowSummary(label: String, value: String) -> String {
        "\(label), \(value)"
    }
}
