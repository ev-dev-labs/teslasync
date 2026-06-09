//
//  EnergySiteInfoWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0047 · EnergySiteInfoWidget (Apple)
//
//  Pure (Foundation-only) projection: a cached `EnergySiteInfoDataDTO` (+ whether any site is
//  linked) → the four display rows, reproducing the web source's numeric pipeline VERBATIM so the
//  native surface shows the exact same values as
//  features/dashboard/widgets/EnergySiteInfoWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Formatting (ported from web lib/numberFormat.ts)

/// Numeric formatting ported from the web widget's helpers (`fmtNumber` / `fmtInt`). Pure so the
/// value pipeline is pinned by unit tests without rendering.
public enum EnergySiteInfoFormat {
    /// The em-dash sentinel the web widget renders for an absent metric (`'—'`).
    public static let emptyDash = "—"

    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, half-away-from-zero
    /// (`Intl.NumberFormat`'s default `halfExpand`). Used for the solar (kW) and Powerwall (kWh)
    /// capacities with `decimals: 1`.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// `fmtInt(v)` — `fmtNumber(v, 0)`: a grouped integer with no fraction digits. Used for the
    /// Powerwall count (`battery_count`).
    public static func int(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }
}

// MARK: - Projected detail row (web `DetailEntry` / `WidgetDetailCard` row)

/// One projected detail row: a localized label and a value string (or `nil`, which the view renders
/// as the em-dash). Mirrors the web `DetailEntry` (`{ label, value, mono }`). `mono` requests the
/// monospaced treatment the web card applies to the gateway-firmware row.
public struct EnergySiteInfoDetailEntry: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String?
    public let mono: Bool

    public init(id: String, labelKey: String, labelFallback: String, value: String?, mono: Bool = false) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.mono = mono
    }

    /// The resolved (localized) label for display + accessibility.
    public var label: String {
        EnergySiteInfoStrings.string(labelKey, labelFallback)
    }

    /// The displayed value, coercing a `nil` to the em-dash exactly as the web card's
    /// `{entry.value ?? '—'}` render does.
    public var displayValue: String {
        value ?? EnergySiteInfoFormat.emptyDash
    }
}

// MARK: - Projection

/// The fully-projected widget content: the ordered detail rows plus whether any Tesla Energy site is
/// linked (the latter selects the empty-state message). Computed once per snapshot by the model so
/// the view stays declarative.
public struct EnergySiteInfoProjection: Equatable, Sendable {
    /// The detail rows (web `entries`) — empty when there is no resolved site info.
    public let entries: [EnergySiteInfoDetailEntry]
    /// Web `hasSites = (sites ?? []).length > 0` — selects the "no site linked" vs "no info" copy.
    public let hasSites: Bool

    public init(entries: [EnergySiteInfoDetailEntry], hasSites: Bool) {
        self.entries = entries
        self.hasSites = hasSites
    }
}

/// Pure projector: `EnergySiteInfoDataDTO?` (+ `hasSites`) → `EnergySiteInfoProjection`. Every value
/// is computed with the exact same arithmetic + formatting as the web widget: `nameplate_power /
/// 1000` → kW, `nameplate_energy / 1000` → kWh, `fmtInt(battery_count)`, and the `version` /
/// `installation_time_zone` strings passed through verbatim.
public enum EnergySiteInfoProjector {
    public static func project(
        info: EnergySiteInfoDataDTO?,
        hasSites: Bool,
        localeIdentifier: String = "en_US"
    ) -> EnergySiteInfoProjection {
        // Web: `if (!hasSites && !isLoading) { /* entries stay [] */ } else if (info) { … }`.
        // With no resolved info the rows are empty and the view renders the `WidgetDetailCard`
        // empty state (message keyed off `hasSites`).
        guard let info else {
            return EnergySiteInfoProjection(entries: [], hasSites: hasSites)
        }

        var entries: [EnergySiteInfoDetailEntry] = []

        // Solar System — `nameplate_power != null ? `${fmtNumber(power/1000, 1)} kW` : '—'`.
        let solarKw = info.nameplatePowerW.map {
            EnergySiteInfoFormat.number($0 / 1000, decimals: 1, localeIdentifier: localeIdentifier)
        }
        entries.append(
            EnergySiteInfoDetailEntry(
                id: "solar",
                labelKey: "widget.energySiteInfo.solarSize",
                labelFallback: "Solar System",
                value: solarKw.map { "\($0) kW" } ?? EnergySiteInfoFormat.emptyDash
            )
        )

        // Powerwalls — `battery_count > 0 ? `${fmtInt(count)} × ${kWh ?? '—'} kWh` : '—'`.
        let batteryCount = info.batteryCount ?? 0
        let batteryKwh = info.nameplateEnergyWh.map {
            EnergySiteInfoFormat.number($0 / 1000, decimals: 1, localeIdentifier: localeIdentifier)
        }
        let powerwallValue: String = batteryCount > 0
            ? "\(EnergySiteInfoFormat.int(Double(batteryCount), localeIdentifier: localeIdentifier)) × "
            + "\(batteryKwh ?? EnergySiteInfoFormat.emptyDash) kWh"
            : EnergySiteInfoFormat.emptyDash
        entries.append(
            EnergySiteInfoDetailEntry(
                id: "powerwall",
                labelKey: "widget.energySiteInfo.powerwall",
                labelFallback: "Powerwalls",
                value: powerwallValue
            )
        )

        // Gateway Firmware — `version` (may be nil → em-dash at render), monospaced.
        entries.append(
            EnergySiteInfoDetailEntry(
                id: "firmware",
                labelKey: "widget.energySiteInfo.firmware",
                labelFallback: "Gateway Firmware",
                value: info.version,
                mono: true
            )
        )

        // Installation Timezone — `installation_time_zone` (may be nil → em-dash at render).
        entries.append(
            EnergySiteInfoDetailEntry(
                id: "timezone",
                labelKey: "widget.energySiteInfo.timezone",
                labelFallback: "Installation Timezone",
                value: info.installationTimeZone
            )
        )

        return EnergySiteInfoProjection(entries: entries, hasSites: hasSites)
    }
}

// MARK: - Layout (web `isCompact`)

/// Pure size → layout mapping, mirroring the web `isCompact = size.cols <= 1` (which hides the
/// `WidgetShell` title + icon and tightens the detail card). Kept testable + SwiftUI-free.
public enum EnergySiteInfoLayout {
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the widget body. Pure + public so the a11y label content
/// can be unit-tested without rendering the view.
public enum EnergySiteInfoAccessibility {
    /// A spoken clause per visible row: the surface title followed by each "label value" pair (an
    /// absent value speaks the em-dash sentinel, matching the visible card).
    public static func summary(for projection: EnergySiteInfoProjection) -> String {
        let title = EnergySiteInfoStrings.string("widget.energySiteInfo.title", "Energy Site")
        var parts = [title]
        for entry in projection.entries {
            parts.append("\(entry.label) \(entry.displayValue)")
        }
        return parts.joined(separator: ". ")
    }

    /// The spoken summary for the empty state: the surface title followed by the same message the
    /// view shows (`hasSites` picks "no site info available" vs "no Tesla Energy site linked").
    public static func emptySummary(hasSites: Bool) -> String {
        let title = EnergySiteInfoStrings.string("widget.energySiteInfo.title", "Energy Site")
        let message = hasSites
            ? EnergySiteInfoStrings.string("widget.energySiteInfo.noData", "No site info available")
            : EnergySiteInfoStrings.string("widget.energySiteInfo.noSite", "No Tesla Energy site linked")
        return "\(title). \(message)"
    }
}
