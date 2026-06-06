import SwiftUI

public extension EnvironmentValues {
    /// The active display-unit preferences used by the SI formatter components.
    @Entry var tsUnits: UnitPreferences = .metric
}

public extension View {
    /// Injects display-unit preferences for the SI formatter components.
    func tsUnits(_ preferences: UnitPreferences) -> some View {
        environment(\.tsUnits, preferences)
    }
}

/// SI distance (meters) formatted to the user's unit (web `Distance`).
public struct TSDistance: View {
    private let meters: Double?
    @Environment(\.tsUnits) private var units

    public init(_ meters: Double?) {
        self.meters = meters
    }

    public var body: some View {
        Text(verbatim: Units.formatDistance(meters, units)).monospacedDigit()
    }
}

/// SI speed (m/s) formatted to the user's unit (web `Speed`).
public struct TSSpeed: View {
    private let metersPerSecond: Double?
    @Environment(\.tsUnits) private var units

    public init(_ metersPerSecond: Double?) {
        self.metersPerSecond = metersPerSecond
    }

    public var body: some View {
        Text(verbatim: Units.formatSpeed(metersPerSecond, units)).monospacedDigit()
    }
}

/// SI temperature (°C) formatted to the user's unit (web `Temperature`).
public struct TSTemperature: View {
    private let celsius: Double?
    @Environment(\.tsUnits) private var units

    public init(_ celsius: Double?) {
        self.celsius = celsius
    }

    public var body: some View {
        Text(verbatim: Units.formatTemperature(celsius, units)).monospacedDigit()
    }
}

/// SI pressure (kPa) formatted to the user's unit (web `Pressure`).
public struct TSPressure: View {
    private let kpa: Double?
    @Environment(\.tsUnits) private var units

    public init(_ kpa: Double?) {
        self.kpa = kpa
    }

    public var body: some View {
        Text(verbatim: Units.formatPressure(kpa, units)).monospacedDigit()
    }
}

/// SI energy (Wh) formatted to the user's unit (web `Energy`).
public struct TSEnergy: View {
    private let wattHours: Double?
    @Environment(\.tsUnits) private var units

    public init(_ wattHours: Double?) {
        self.wattHours = wattHours
    }

    public var body: some View {
        Text(verbatim: Units.formatEnergy(wattHours, units)).monospacedDigit()
    }
}

/// SI power (W) formatted to the user's unit (web `Power`).
public struct TSPower: View {
    private let watts: Double?
    @Environment(\.tsUnits) private var units

    public init(_ watts: Double?) {
        self.watts = watts
    }

    public var body: some View {
        Text(verbatim: Units.formatPower(watts, units)).monospacedDigit()
    }
}

/// SI duration (seconds) formatted to the user's unit (web `Duration`).
public struct TSDuration: View {
    private let seconds: Double?
    @Environment(\.tsUnits) private var units

    public init(_ seconds: Double?) {
        self.seconds = seconds
    }

    public var body: some View {
        Text(verbatim: Units.formatDuration(seconds, units)).monospacedDigit()
    }
}
