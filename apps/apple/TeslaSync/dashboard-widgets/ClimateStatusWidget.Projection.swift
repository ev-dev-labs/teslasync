//
//  ClimateStatusWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0028 · ClimateStatusWidget (Apple)
//
//  The cached → view-ready projection: the three labeled rows (Cabin / Outside /
//  HVAC — web `Row`s) and the Defrost / Heater status chips (each present only when
//  active). Every string is resolved through the injected localizer so the builder
//  is bundle-free in tests. Pure + Foundation-only; the conversions / formatters /
//  derivations it composes live in ClimateStatusWidget.Adapter.swift.
//

import Foundation

// MARK: - Semantic tone (mapped to a Color only in the Views layer)

/// The semantic tint a chip carries, kept Foundation-only so the projection stays
/// testable. The view maps each case to a design token: `defrost → speed` (web
/// `text-blue-400`), `heater → energy` (web `text-orange-400`).
public enum ClimateStatusTone: String, Sendable, Equatable {
    case defrost
    case heater
}

// MARK: - One labeled row (web `Row`)

/// A single labeled metric row — the native port of the web `Row` (muted label on
/// the leading edge, emphasized value on the trailing edge). `Identifiable` +
/// `Equatable` so SwiftUI can diff the stack and the projection can be asserted in
/// tests.
public struct ClimateStatusRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String

    public init(id: String, label: String, value: String) {
        self.id = id
        self.label = label
        self.value = value
    }
}

// MARK: - One status chip (web Defrost / Heater pills)

/// One tinted pill — the Defrost or Heater status chip. Carries its already-composed
/// display text, an SF Symbol name, and a semantic tone.
public struct ClimateStatusChip: Identifiable, Equatable, Sendable {
    public let id: String
    public let text: String
    public let systemImage: String
    public let tone: ClimateStatusTone

    public init(id: String, text: String, systemImage: String, tone: ClimateStatusTone) {
        self.id = id
        self.text = text
        self.systemImage = systemImage
        self.tone = tone
    }
}

// MARK: - Projection (the adapter output)

/// Everything the view needs to render, derived purely from the cached climate row
/// + the user's temperature unit. Built by `ClimateStatusProjectionBuilder`.
public struct ClimateStatusProjection: Equatable, Sendable {
    /// Cabin, Outside, HVAC — in web row order.
    public let rows: [ClimateStatusRow]
    /// The Defrost / Heater status chips (each present only when active).
    public let chips: [ClimateStatusChip]

    public init(rows: [ClimateStatusRow], chips: [ClimateStatusChip]) {
        self.rows = rows
        self.chips = chips
    }

    /// The neutral initial / no-data projection. The model only renders this when it
    /// also reports the loading or empty phase, so the values are inert.
    public static let empty = ClimateStatusProjection(rows: [], chips: [])
}

// MARK: - Builder (port of the web content composition)

/// Pure adapter: a cached `ClimateStatusInput` + the temperature unit → the
/// projection, resolving every label/value through the injected localizer. A
/// faithful port of the web content block (the three `Row`s + the Defrost / Heater
/// chip row).
public enum ClimateStatusProjectionBuilder {
    /// SF Symbols chosen as the Apple-idiomatic counterparts of the web lucide icons
    /// (Thermometer, Snowflake, Zap).
    enum Symbol {
        static let snowflake = "snowflake"
        static let bolt = "bolt.fill"
    }

    public static func build(
        input: ClimateStatusInput,
        unit: ClimateStatusTemperatureUnit,
        localize: (String, String) -> String = ClimateStatusStrings.string
    ) -> ClimateStatusProjection {
        ClimateStatusProjection(
            rows: rows(input: input, unit: unit, localize: localize),
            chips: chips(input, localize: localize)
        )
    }

    // MARK: Rows

    private static func rows(
        input: ClimateStatusInput,
        unit: ClimateStatusTemperatureUnit,
        localize: (String, String) -> String
    ) -> [ClimateStatusRow] {
        [
            ClimateStatusRow(
                id: "cabin",
                label: localize("widget.cabin", "Cabin"),
                value: ClimateStatusDerive.insideDisplay(input, unit: unit)
            ),
            ClimateStatusRow(
                id: "outside",
                label: localize("widget.outside", "Outside"),
                value: ClimateStatusDerive.outsideDisplay(input, unit: unit)
            ),
            ClimateStatusRow(
                id: "hvac",
                label: localize("widget.hvac", "HVAC"),
                value: ClimateStatusDerive.hvacDisplay(
                    input,
                    kilowattUnit: localize("widget.climateStatus.kw", "kW")
                )
            )
        ]
    }

    // MARK: Status chips

    static func chips(
        _ input: ClimateStatusInput,
        localize: (String, String) -> String
    ) -> [ClimateStatusChip] {
        var chips: [ClimateStatusChip] = []
        if ClimateStatusDerive.defrostActive(input) {
            chips.append(ClimateStatusChip(
                id: "defrost",
                text: localize("widget.defrost", "Defrost"),
                systemImage: Symbol.snowflake,
                tone: .defrost
            ))
        }
        if ClimateStatusDerive.batteryHeaterOn(input) {
            chips.append(ClimateStatusChip(
                id: "heater",
                text: localize("widget.batHeater", "Heater"),
                systemImage: Symbol.bolt,
                tone: .heater
            ))
        }
        return chips
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the whole status panel. Pure + public so
/// the a11y content can be unit-tested without rendering the view.
public enum ClimateStatusAccessibility {
    /// A one-pass spoken summary: each labeled row ("Cabin 22°C"), then any active
    /// status chips ("Defrost", "Heater").
    public static func summary(for projection: ClimateStatusProjection) -> String {
        var parts: [String] = projection.rows.map { "\($0.label) \($0.value)" }
        parts.append(contentsOf: projection.chips.map(\.text))
        return parts.joined(separator: ", ")
    }
}
