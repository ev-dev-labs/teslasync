//
//  ClimateControlPanelWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0026 · ClimateControlPanelWidget (Apple)
//
//  The cached → view-ready projection: the HVAC status + optional kW readout, the
//  four labeled metric cells (Cabin / Outside / Fan Speed / Wheel Heat — web
//  `MetricCell`s), the active seat-heater chips, the Defrost / Bat-Heater status
//  chips, and the compact single-temperature value. Every string is resolved
//  through the injected localizer so the builder is bundle-free in tests. Pure +
//  Foundation-only; the conversions / formatters / derivations it composes live in
//  ClimateControlPanelWidget.Adapter.swift.
//

import Foundation

// MARK: - Semantic tone (mapped to a Color only in the Views layer)

/// The semantic tint a metric icon or chip carries, kept Foundation-only so the
/// projection stays testable. The view maps each case to a design token: `cabin →
/// accent` (web `text-neon-cyan`), `outside / defrost → speed` (web
/// `text-blue-400`), `seat / batteryHeater → energy` (web `text-orange-400`),
/// `muted → text-muted`.
public enum ClimatePanelTone: String, Sendable, Equatable {
    case cabin
    case outside
    case seat
    case defrost
    case batteryHeater
    case muted
}

// MARK: - One labeled metric cell (web `MetricCell`)

/// A single labeled metric — the native port of the web `MetricCell` (icon + muted
/// label + emphasized value). `Identifiable` + `Equatable` so SwiftUI can diff the
/// grid and the projection can be asserted in tests.
public struct ClimatePanelMetric: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let value: String
    public let tone: ClimatePanelTone
    public let systemImage: String

    public init(
        id: String,
        title: String,
        value: String,
        tone: ClimatePanelTone,
        systemImage: String
    ) {
        self.id = id
        self.title = title
        self.value = value
        self.tone = tone
        self.systemImage = systemImage
    }
}

// MARK: - One pill chip (web seat-heater + status badges)

/// One tinted pill — a seat-heater chip (`Armchair FL 2/3`) or a status chip
/// (`Defrost`, `Bat Heater`). Carries its already-composed display text, a spoken
/// accessibility variant, an SF Symbol name, and a semantic tone.
public struct ClimatePanelChip: Identifiable, Equatable, Sendable {
    public let id: String
    public let text: String
    public let accessibilityText: String
    public let systemImage: String
    public let tone: ClimatePanelTone

    public init(
        id: String,
        text: String,
        accessibilityText: String,
        systemImage: String,
        tone: ClimatePanelTone
    ) {
        self.id = id
        self.text = text
        self.accessibilityText = accessibilityText
        self.systemImage = systemImage
        self.tone = tone
    }
}

// MARK: - Projection (the adapter output)

/// Everything the view needs to render, derived purely from the cached climate row
/// + the user's temperature unit. Built by `ClimatePanelProjectionBuilder`.
public struct ClimatePanelProjection: Equatable, Sendable {
    /// Web `hvacOn` — drives the success/neutral status badge.
    public let hvacOn: Bool
    /// The localized HVAC status text ("HVAC On" / "HVAC Off").
    public let hvacStatusText: String
    /// The kW readout ("2.3 kW"), or `nil` when power is absent / not positive.
    public let hvacPowerText: String?
    /// Cabin, Outside, Fan Speed, Wheel Heat — in web order.
    public let metrics: [ClimatePanelMetric]
    /// The active seat-heater chips (empty when none are on).
    public let seatChips: [ClimatePanelChip]
    /// The localized "No seat heaters active" fallback text.
    public let noSeatHeatText: String
    /// The Defrost / Bat-Heater status chips (each present only when active).
    public let statusChips: [ClimatePanelChip]
    /// The single inside-temperature value shown in the compact (1×1) layout.
    public let compactValue: String
    /// The temperature unit suffix (web `tempUnit`).
    public let temperatureUnitLabel: String

    public init(
        hvacOn: Bool,
        hvacStatusText: String,
        hvacPowerText: String?,
        metrics: [ClimatePanelMetric],
        seatChips: [ClimatePanelChip],
        noSeatHeatText: String,
        statusChips: [ClimatePanelChip],
        compactValue: String,
        temperatureUnitLabel: String
    ) {
        self.hvacOn = hvacOn
        self.hvacStatusText = hvacStatusText
        self.hvacPowerText = hvacPowerText
        self.metrics = metrics
        self.seatChips = seatChips
        self.noSeatHeatText = noSeatHeatText
        self.statusChips = statusChips
        self.compactValue = compactValue
        self.temperatureUnitLabel = temperatureUnitLabel
    }

    /// The neutral initial / no-data projection. The model only renders this when
    /// it also reports the loading or empty phase, so the values are inert.
    public static let empty = ClimatePanelProjection(
        hvacOn: false,
        hvacStatusText: "",
        hvacPowerText: nil,
        metrics: [],
        seatChips: [],
        noSeatHeatText: "",
        statusChips: [],
        compactValue: ClimatePanelNumberFormat.dash,
        temperatureUnitLabel: ClimatePanelTemperatureUnit.celsius.label
    )
}

// MARK: - Builder (port of the web FullView / CompactView composition)

/// Pure adapter: a cached `ClimatePanelInput` + the temperature unit → the
/// projection, resolving every label/value through the injected localizer. A
/// faithful port of the web `FullView` / `CompactView` composition + the
/// `MetricCell` value rules.
public enum ClimatePanelProjectionBuilder {
    /// SF Symbols chosen as the Apple-idiomatic counterparts of the web lucide
    /// icons (Thermometer, Fan, CircleDot, Armchair, Snowflake, Zap).
    enum Symbol {
        static let thermometer = "thermometer.medium"
        static let fan = "fan.fill"
        static let steeringWheel = "steeringwheel"
        static let seat = "carseat.right.fill"
        static let snowflake = "snowflake"
        static let bolt = "bolt.fill"
    }

    public static func build(
        input: ClimatePanelInput,
        unit: ClimatePanelTemperatureUnit,
        localize: (String, String) -> String = ClimatePanelStrings.string
    ) -> ClimatePanelProjection {
        let unitLabel = unit.label
        let insideValue = temperatureValue(ClimatePanelDerive.insideDisplay(input, unit: unit), unitLabel: unitLabel)
        let outsideValue = temperatureValue(ClimatePanelDerive.outsideDisplay(input, unit: unit), unitLabel: unitLabel)

        return ClimatePanelProjection(
            hvacOn: ClimatePanelDerive.hvacOn(input),
            hvacStatusText: hvacStatusText(input, localize: localize),
            hvacPowerText: hvacPowerText(input, localize: localize),
            metrics: metrics(
                input: input,
                insideValue: insideValue,
                outsideValue: outsideValue,
                localize: localize
            ),
            seatChips: seatChips(input, localize: localize),
            noSeatHeatText: localize("widget.climatePanel.noSeatHeat", "No seat heaters active"),
            statusChips: statusChips(input, localize: localize),
            compactValue: insideValue,
            temperatureUnitLabel: unitLabel
        )
    }

    // MARK: HVAC status + power

    static func hvacStatusText(_ input: ClimatePanelInput, localize: (String, String) -> String) -> String {
        ClimatePanelDerive.hvacOn(input)
            ? localize("widget.climatePanel.hvacOn", "HVAC On")
            : localize("widget.climatePanel.hvacOff", "HVAC Off")
    }

    static func hvacPowerText(_ input: ClimatePanelInput, localize: (String, String) -> String) -> String? {
        guard let power = ClimatePanelDerive.hvacPowerKW(input) else { return nil }
        let unit = localize("widget.climatePanel.kw", "kW")
        return "\(ClimatePanelNumberFormat.decimal1(power)) \(unit)"
    }

    // MARK: Metric cells

    private static func metrics(
        input: ClimatePanelInput,
        insideValue: String,
        outsideValue: String,
        localize: (String, String) -> String
    ) -> [ClimatePanelMetric] {
        [
            ClimatePanelMetric(
                id: "cabin",
                title: localize("widget.climatePanel.cabin", "Cabin"),
                value: insideValue,
                tone: .cabin,
                systemImage: Symbol.thermometer
            ),
            ClimatePanelMetric(
                id: "outside",
                title: localize("widget.climatePanel.outside", "Outside"),
                value: outsideValue,
                tone: .outside,
                systemImage: Symbol.thermometer
            ),
            ClimatePanelMetric(
                id: "fan",
                title: localize("widget.climatePanel.fanSpeed", "Fan Speed"),
                value: fanValue(input),
                tone: .muted,
                systemImage: Symbol.fan
            ),
            ClimatePanelMetric(
                id: "wheel",
                title: localize("widget.climatePanel.steeringHeat", "Wheel Heat"),
                value: wheelValue(input, localize: localize),
                tone: .muted,
                systemImage: Symbol.steeringWheel
            )
        ]
    }

    /// Web `temps?.inside != null ? ${inside}${tempUnit} : '—'`.
    static func temperatureValue(_ display: String?, unitLabel: String) -> String {
        guard let display else { return ClimatePanelNumberFormat.dash }
        return "\(display)\(unitLabel)"
    }

    /// Web `hvac_fan_speed != null ? ${hvac_fan_speed} : '—'`.
    static func fanValue(_ input: ClimatePanelInput) -> String {
        guard let fan = input.hvacFanSpeed, fan.isFinite else { return ClimatePanelNumberFormat.dash }
        return ClimatePanelNumberFormat.plain(fan)
    }

    /// Web `steeringHeat > 0 ? ${steeringHeat}/3 : t('off', 'Off')`.
    static func wheelValue(_ input: ClimatePanelInput, localize: (String, String) -> String) -> String {
        let level = ClimatePanelDerive.steeringLevel(input)
        return level > 0 ? "\(level)/3" : localize("widget.climatePanel.off", "Off")
    }

    // MARK: Seat-heater + status chips

    static func seatChips(_ input: ClimatePanelInput, localize: (String, String) -> String) -> [ClimatePanelChip] {
        ClimatePanelDerive.activeSeats(input).map { seat in
            let label = localize(seat.position.labelKey, seat.position.labelFallback)
            return ClimatePanelChip(
                id: "seat-\(seat.position.rawValue)",
                text: "\(label) \(seat.level)/3",
                accessibilityText: "\(label) \(seat.level)/3",
                systemImage: Symbol.seat,
                tone: .seat
            )
        }
    }

    static func statusChips(_ input: ClimatePanelInput, localize: (String, String) -> String) -> [ClimatePanelChip] {
        var chips: [ClimatePanelChip] = []
        if ClimatePanelDerive.defrostActive(input) {
            let text = localize("widget.climatePanel.defrost", "Defrost")
            chips.append(ClimatePanelChip(
                id: "defrost",
                text: text,
                accessibilityText: text,
                systemImage: Symbol.snowflake,
                tone: .defrost
            ))
        }
        if ClimatePanelDerive.batteryHeaterOn(input) {
            let text = localize("widget.climatePanel.batHeater", "Bat Heater")
            chips.append(ClimatePanelChip(
                id: "battery-heater",
                text: text,
                accessibilityText: text,
                systemImage: Symbol.bolt,
                tone: .batteryHeater
            ))
        }
        return chips
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the full panel. Pure + public so the a11y
/// content can be unit-tested without rendering the view.
public enum ClimatePanelAccessibility {
    /// A one-pass spoken summary: HVAC state (+ power), cabin / outside temps, fan,
    /// wheel heat, then the active seat heaters (or the no-seat-heaters fallback)
    /// and any status chips.
    public static func summary(for projection: ClimatePanelProjection) -> String {
        var parts: [String] = []

        if let power = projection.hvacPowerText {
            parts.append("\(projection.hvacStatusText), \(power)")
        } else {
            parts.append(projection.hvacStatusText)
        }

        for metric in projection.metrics {
            parts.append("\(metric.title) \(metric.value)")
        }

        if projection.seatChips.isEmpty {
            parts.append(projection.noSeatHeatText)
        } else {
            parts.append(contentsOf: projection.seatChips.map(\.accessibilityText))
        }

        parts.append(contentsOf: projection.statusChips.map(\.accessibilityText))

        return parts.joined(separator: ", ")
    }
}
