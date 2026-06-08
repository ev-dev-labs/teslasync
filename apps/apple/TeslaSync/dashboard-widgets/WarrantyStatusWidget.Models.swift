//
//  WarrantyStatusWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0113 · WarrantyStatusWidget (Apple)
//
//  Domain value types ported from the web source
//  (features/dashboard/widgets/WarrantyStatusWidget.tsx): the untyped warranty
//  DTO input (a `Record<string, unknown>` mirror), the display-formatting context
//  (distance unit + locale + tz), the status variant, the metric/detail-entry
//  view-models, and the merged projection the view renders. No SwiftUI / transport
//  here — this is the deterministic core both platforms agree on.
//

import Foundation

// MARK: - Untyped DTO input (web `warrantyData: Record<string, unknown>`)

/// One value inside the untyped warranty envelope, mirroring the JS `unknown`
/// cells the web `asString` / `asNumber` helpers narrow. Modeled as a closed enum
/// so the adapter's narrowing is total and testable.
public enum WarrantyValue: Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
}

/// Value-typed mirror of the web `warrantyData` object — an ordered bag of
/// untyped cells keyed by the backend's snake_case field names. The web reads it
/// by dynamic key (including the computed `"\(coverage)_expiry_date"` lookups), so
/// a keyed bag is the most faithful port; the adapter narrows each cell exactly
/// like the web `asString` / `asNumber` helpers.
public struct WarrantyDataInput: Sendable, Equatable {
    private let fields: [String: WarrantyValue]

    public init(_ fields: [String: WarrantyValue]) {
        self.fields = fields
    }

    /// Raw cell for a key (web `warrantyData[key]`), `nil` when absent.
    public func value(_ key: String) -> WarrantyValue? {
        fields[key]
    }
}

// MARK: - Display-formatting context (web useUnits / useDateFormat)

/// The display-unit + locale context the projection formats through, mirroring the
/// web `useUnits` (`unitPrefs.distance`) and `useDateFormat` (`locale`, `tz`) hooks.
/// The production source fills this from the shared settings store; previews/tests
/// pass it explicitly so the adapter is deterministic.
public struct WarrantyFormatting: Sendable, Equatable {
    /// Distance display unit label — `"km"` / `"mi"` / `"ft"` (web `unitPrefs.distance`).
    public var distanceUnit: String
    /// BCP-47 locale for number grouping + date rendering (web settings locale).
    public var localeIdentifier: String
    /// IANA time-zone for date rendering (web `tz`).
    public var timeZoneIdentifier: String

    public init(
        distanceUnit: String = "mi",
        localeIdentifier: String = "en_US",
        timeZoneIdentifier: String = "UTC"
    ) {
        self.distanceUnit = distanceUnit
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
    }

    /// US-imperial default used by previews and the empty model state.
    public static let `default` = WarrantyFormatting()
}

// MARK: - Status variant (web `statusVariant`)

/// Warranty health derived from the days remaining (web
/// `'success' | 'warning' | 'error'`). The SwiftUI tone mapping lives in the view
/// layer so this stays Foundation-only.
public enum WarrantyVariant: String, Sendable, Equatable, CaseIterable {
    case success
    case warning
    case error
}

// MARK: - Localizable reference (key + web English fallback)

/// A deferred string reference: the i18n key plus its web `t(key, default)`
/// English fallback. The adapter emits these (pure data) and the view resolves
/// them through the P1/S10 facade, so no English literal is baked into rendered
/// output and the projection stays testable without `NSLocalizedString`.
public struct WarrantyText: Sendable, Equatable {
    public let key: String
    public let fallback: String

    public init(_ key: String, _ fallback: String) {
        self.key = key
        self.fallback = fallback
    }
}

// MARK: - Badge (web `<Badge variant>` chip)

/// A status chip view-model (web `Badge`): a localizable label + its semantic
/// variant (→ tone in the view).
public struct WarrantyBadge: Sendable, Equatable {
    public var label: WarrantyText
    public var variant: WarrantyVariant

    public init(label: WarrantyText, variant: WarrantyVariant) {
        self.label = label
        self.variant = variant
    }

    /// Web `statusLabel` → "Active" (success/warning carry the same label, the
    /// variant drives the colour).
    public static func active(_ variant: WarrantyVariant) -> WarrantyBadge {
        WarrantyBadge(label: WarrantyText("widget.warranty.active", "Active"), variant: variant)
    }

    /// Web `statusLabel` → "Expired".
    public static let expired = WarrantyBadge(
        label: WarrantyText("widget.warranty.expired", "Expired"),
        variant: .error
    )

    /// Web coverage badge → "Covered".
    public static let covered = WarrantyBadge(
        label: WarrantyText("widget.warranty.covered", "Covered"),
        variant: .success
    )
}

// MARK: - Metric bar (web `MetricBar`)

/// The unit shown to the right of a metric value: either a distance symbol
/// (`"mi"` — not translated) or a localizable word (`"days"`).
public enum WarrantyUnitLabel: Sendable, Equatable {
    case symbol(String)
    case localized(WarrantyText)
}

/// A labeled proportion bar (web `MetricBar`): the title, the fill fraction
/// (0…1, already clamped), the pre-formatted value + its unit, and the colour
/// variant. Mirrors the web `value/max` bar plus its `label` / `sublabel`.
public struct WarrantyMetric: Sendable, Equatable {
    public var label: WarrantyText
    /// Fill fraction in `0...1` (web `Math.min(value / max, 1)`).
    public var fraction: Double
    /// Pre-formatted numeric readout (web `fmtInt` / `fmtNumber`), unit appended
    /// in the view.
    public var valueText: String
    public var unit: WarrantyUnitLabel
    public var variant: WarrantyVariant

    public init(
        label: WarrantyText,
        fraction: Double,
        valueText: String,
        unit: WarrantyUnitLabel,
        variant: WarrantyVariant
    ) {
        self.label = label
        self.fraction = fraction
        self.valueText = valueText
        self.unit = unit
        self.variant = variant
    }
}

// MARK: - Detail entry (web `WidgetDetailCard` row / `DetailEntry`)

/// The value cell of a detail row: absent (`'—'`), a pre-formatted literal
/// (dates / numbers), or a localizable word (`"Included"`).
public enum WarrantyDetailValue: Sendable, Equatable {
    case none
    case text(String)
    case localized(WarrantyText)
}

/// One `WidgetDetailCard` row (web `DetailEntry`): a label, a value cell, an
/// optional trailing badge, and the monospace flag for numeric values.
public struct WarrantyDetailEntry: Sendable, Equatable, Identifiable {
    public let id: String
    public var label: WarrantyText
    public var value: WarrantyDetailValue
    public var mono: Bool
    public var badge: WarrantyBadge?

    public init(
        id: String,
        label: WarrantyText,
        value: WarrantyDetailValue,
        mono: Bool = false,
        badge: WarrantyBadge? = nil
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.mono = mono
        self.badge = badge
    }
}

// MARK: - Projection (the merged view-model the view renders)

/// The fully-projected widget content — the single value the view switches over
/// (web compact headline + the two `MetricBar`s + the `WidgetDetailCard` entries).
public struct WarrantyProjection: Sendable, Equatable {
    /// Whether the envelope carried a `data` object (web `warrantyData != null`).
    /// `false` is the resolved-but-empty state.
    public var hasData: Bool
    /// Numeric days remaining (web `daysRemaining`), kept for a11y + the compact
    /// headline; `nil` when no/invalid expiry date.
    public var daysRemaining: Int?
    /// Pre-formatted compact headline (web `fmtInt(Math.max(daysRemaining, 0))`,
    /// `'—'` when unknown).
    public var headlineText: String
    public var statusVariant: WarrantyVariant
    /// Active/Expired chip (web `statusLabel` + `statusVariant`).
    public var statusBadge: WarrantyBadge
    public var timeMetric: WarrantyMetric?
    public var mileageMetric: WarrantyMetric?
    public var entries: [WarrantyDetailEntry]

    public init(
        hasData: Bool,
        daysRemaining: Int?,
        headlineText: String,
        statusVariant: WarrantyVariant,
        statusBadge: WarrantyBadge,
        timeMetric: WarrantyMetric?,
        mileageMetric: WarrantyMetric?,
        entries: [WarrantyDetailEntry]
    ) {
        self.hasData = hasData
        self.daysRemaining = daysRemaining
        self.headlineText = headlineText
        self.statusVariant = statusVariant
        self.statusBadge = statusBadge
        self.timeMetric = timeMetric
        self.mileageMetric = mileageMetric
        self.entries = entries
    }

    /// The resolved-but-empty projection (web `warrantyData === null`).
    public static let empty = WarrantyProjection(
        hasData: false,
        daysRemaining: nil,
        headlineText: "—",
        statusVariant: .error,
        statusBadge: .expired,
        timeMetric: nil,
        mileageMetric: nil,
        entries: []
    )
}
