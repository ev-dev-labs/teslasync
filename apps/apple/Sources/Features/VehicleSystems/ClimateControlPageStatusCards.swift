import SwiftUI

// MARK: - Climate status cards (web 6-card grid → 13 MetricCards)

/// The climate-status metric grid (web `grid-cols-2 lg:grid-cols-3`): 13 cards
/// covering HVAC power, auto conditioning, climate keeper, fan, steering-wheel
/// heat, defrost, wiper, and rear-display HVAC. Each card guards its own nil
/// field with an em-dash / Off / Unknown, exactly like the web.
struct ClimateStatusCards: View {
    let latest: ClimateSnapshot?
    let isCompact: Bool

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            hvacPowerCard
            autoConditioningCard
            climateKeeperCard
            fanSpeedCard
            fanStatusCard
            steeringHeaterCard
            steeringHeatLevelCard
            steeringHeatAutoCard
            defrostModeCard
            defrostPrecondCard
            rearDefrostCard
            wiperHeaterCard
            rearDisplayHvacCard
        }
    }

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: isCompact ? 2 : 3)
    }

    private var hvacPowerCard: some View {
        let on = latest?.isAcOn == true
        return ClimateMetricCard(
            label: "HVAC Power",
            value: Text(on ? "On" : "Off"),
            systemImage: "power",
            tone: on ? .accent : .neutral,
            subtitle: latest?.hvacPower.map { Text("State") + Text(verbatim: ": \($0)") }
        )
    }

    private var autoConditioningCard: some View {
        let on = (latest?.hvacAutoMode).map { $0 != "Off" } ?? false
        return ClimateMetricCard(
            label: "Auto Conditioning",
            value: Text(on ? "On" : "Off"),
            systemImage: "gearshape.fill",
            tone: on ? .info : .neutral
        )
    }

    private var climateKeeperCard: some View {
        let active = ClimateKeeper.isActive(latest?.climateKeeperMode)
        return ClimateMetricCard(
            label: "Climate Keeper",
            value: Text(ClimateKeeper.labelKey(latest?.climateKeeperMode)),
            systemImage: "thermometer.sun.fill",
            tone: active ? .warning : .neutral,
            subtitle: active ? Text("Active") : nil
        )
    }

    private var fanSpeedCard: some View {
        ClimateMetricCard(
            label: "Fan Speed",
            value: Text(verbatim: String(latest?.fanSpeed ?? 0)),
            systemImage: "wind",
            tone: .accent,
            subtitle: Text("Level 0–10")
        )
    }

    private var fanStatusCard: some View {
        let status = latest?.hvacFanStatus
        let running = (status ?? 0) > 0
        let value = status.map { Text($0 > 0 ? "Running" : "Idle") } ?? Text(verbatim: ClimateFormat.dash)
        return ClimateMetricCard(
            label: "Fan Status",
            value: value,
            systemImage: "wind",
            tone: running ? .accent : .neutral,
            subtitle: status.map { Text("Code") + Text(verbatim: " \($0)") }
        )
    }

    private var steeringHeaterCard: some View {
        let on = (latest?.hvacSteeringWheelHeatLevel ?? 0) > 0
        return ClimateMetricCard(
            label: "Steering Wheel Heater",
            value: Text(on ? "On" : "Off"),
            systemImage: "gauge.medium",
            tone: on ? .warning : .neutral
        )
    }

    private var steeringHeatLevelCard: some View {
        let level = latest?.hvacSteeringWheelHeatLevel
        let resolved = level.map { ClimateLevel.clamp($0) }
        let value = resolved.map { Text($0.labelKey) } ?? Text(verbatim: ClimateFormat.dash)
        return ClimateMetricCard(
            label: "Steering Wheel Heat Level",
            value: value,
            systemImage: "flame.fill",
            tone: resolved?.heatTone ?? .neutral,
            subtitle: level.map { Text("Level") + Text(verbatim: " \($0)") }
        )
    }

    private var steeringHeatAutoCard: some View {
        let auto = latest?.hvacSteeringWheelHeatAuto
        let value = auto.map { Text($0 ? "Auto" : "Manual") } ?? Text(verbatim: ClimateFormat.dash)
        return ClimateMetricCard(
            label: "Steering Wheel Heat Auto",
            value: value,
            systemImage: "waveform.path.ecg",
            tone: auto == true ? .warning : .neutral
        )
    }

    private var defrostModeCard: some View {
        let mode = latest?.defrostMode
        let active = mode != nil && mode != "Off"
        let value = active ? Text(verbatim: mode ?? "") : Text("Off")
        return ClimateMetricCard(
            label: "Defrost Mode",
            value: value,
            systemImage: "snowflake",
            tone: active ? .info : .neutral
        )
    }

    private var defrostPrecondCard: some View {
        let precond = latest?.defrostForPreconditioning
        let value = precond.map { Text($0 ? "Active" : "Inactive") } ?? Text(verbatim: ClimateFormat.dash)
        return ClimateMetricCard(
            label: "Defrost for Preconditioning",
            value: value,
            systemImage: "snowflake",
            tone: precond == true ? .accent : .neutral,
            subtitle: precond == true ? Text("Clearing windshield before drive") : nil
        )
    }

    private var rearDefrostCard: some View {
        let rear = latest?.rearDefrostEnabled
        let value = rear.map { Text($0 ? "On" : "Off") } ?? Text(verbatim: ClimateFormat.dash)
        return ClimateMetricCard(
            label: "Rear Defrost",
            value: value,
            systemImage: "snowflake",
            tone: rear == true ? .info : .neutral,
            subtitle: rear == true ? Text("Clearing rear window") : nil
        )
    }

    private var wiperHeaterCard: some View {
        let wiper = latest?.wiperHeatEnabled
        let value = wiper.map { Text($0 ? "On" : "Off") } ?? Text(verbatim: ClimateFormat.dash)
        return ClimateMetricCard(
            label: "Wiper Heater",
            value: value,
            systemImage: "flame.fill",
            tone: wiper == true ? .warning : .neutral,
            subtitle: wiper == true ? Text("Heating windshield wipers") : nil
        )
    }

    private var rearDisplayHvacCard: some View {
        let rear = latest?.rearDisplayHvacEnabled
        let value = rear.map { Text($0 ? "Enabled" : "Disabled") } ?? Text(verbatim: ClimateFormat.dash)
        return ClimateMetricCard(
            label: "Rear Display HVAC",
            value: value,
            systemImage: "display",
            tone: rear == true ? .accent : .neutral,
            subtitle: rear == true ? Text("Rear passengers can control HVAC") : nil
        )
    }
}

// MARK: - Protection & safety row (web 4-card grid)

/// The protection & safety metric row (web `grid-cols-1 sm:grid-cols-2
/// lg:grid-cols-4`): Overheat Protection, Overheat Temp Limit, Battery Heater,
/// and Passenger Setting (converted to the user's unit).
struct ClimateProtectionRow: View {
    let latest: ClimateSnapshot?
    let fahrenheit: Bool
    let unitLabel: String
    let isCompact: Bool

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            overheatProtectionCard
            overheatTempLimitCard
            batteryHeaterCard
            passengerSettingCard
        }
    }

    private var overheatProtectionCard: some View {
        let value = (latest?.overheatProtection).map { Text(verbatim: $0) } ?? Text("Unknown")
        return ClimateMetricCard(
            label: "Overheat Protection",
            value: value,
            systemImage: "checkmark.shield.fill",
            tone: .success
        )
    }

    private var overheatTempLimitCard: some View {
        let value = (latest?.cabinOverheatProtectionTempLimit).map { Text(verbatim: $0) }
            ?? Text(verbatim: ClimateFormat.dash)
        return ClimateMetricCard(
            label: "Overheat Temp Limit",
            value: value,
            systemImage: "thermometer.sun.fill",
            tone: .warning
        )
    }

    private var batteryHeaterCard: some View {
        let on = latest?.batteryHeater == true
        return ClimateMetricCard(
            label: "Battery Heater",
            value: Text(on ? "On" : "Off"),
            systemImage: "battery.100.bolt",
            tone: on ? .warning : .neutral
        )
    }

    private var passengerSettingCard: some View {
        let value = (latest?.passengerTempSetting).map { celsius in
            Text(verbatim: ClimateFormat.temperatureWithUnit(celsius, fahrenheit: fahrenheit, unitLabel: unitLabel))
        } ?? Text(verbatim: ClimateFormat.dash)
        return ClimateMetricCard(
            label: "Passenger Setting",
            value: value,
            systemImage: "thermometer.medium",
            tone: .info
        )
    }
}
