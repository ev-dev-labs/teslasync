//
//  FleetApiSection.SignalConfig.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  The native affordance the Fleet Telemetry Subscribe tool opens for the web
//  `@/components/ui/SignalConfigModal`. The full modal is an atomic shared
//  component owned by the P4 component-library bundle prompt (out of scope here);
//  this surface ships a self-contained, fully functional signal-selection sheet
//  over the canonical telemetry-field catalog (a verbatim port of `TELEMETRY_FIELDS`)
//  so the Subscribe tool reaches parity: pick streamed signals + an interval, feed
//  the subscribe payload. Field/category identifiers are Tesla-domain data (rendered
//  verbatim); the sheet chrome resolves through the surface i18n facade.
//

import SwiftUI

// MARK: - Telemetry field catalog (port of `TELEMETRY_FIELDS`)

/// One telemetry signal category and its field identifiers.
public struct FleetSignalCategory: Sendable, Equatable, Identifiable {
    public let name: String
    public let fields: [String]

    public var id: String {
        name
    }

    public init(name: String, fields: [String]) {
        self.name = name
        self.fields = fields
    }
}

/// The canonical Fleet Telemetry signal catalog (ported verbatim from the web
/// `TELEMETRY_FIELDS`): 12 categories, 230 fields.
public enum FleetTelemetryFields {
    public static let categories: [FleetSignalCategory] = [
        FleetSignalCategory(
            name: "Location",
            fields: [
                "Location", "GpsHeading", "GpsState", "DestinationLocation", "DestinationName",
                "MilesToArrival", "MinutesToArrival", "RouteLine", "RouteLastUpdated", "OriginLocation",
                "LocatedAtHome", "LocatedAtWork", "LocatedAtFavorite"
            ]
        ),
        FleetSignalCategory(
            name: "Driving",
            fields: [
                "VehicleSpeed", "Gear", "CruiseSetSpeed", "BrakePedal", "BrakePedalPos", "PedalPosition",
                "DriveRail", "LateralAcceleration", "LongitudinalAcceleration", "RouteTrafficMinutesDelay",
                "LifetimeEnergyGainedRegen", "LifetimeEnergyUsedDrive"
            ]
        ),
        FleetSignalCategory(
            name: "Charging",
            fields: [
                "BatteryLevel", "Soc", "ChargeState", "DetailedChargeState", "ChargeLimitSoc", "ChargeAmps",
                "ChargeCurrentRequest", "ChargeCurrentRequestMax", "ChargeEnableRequest", "ChargerVoltage",
                "ChargerPhases", "ChargeRateMilePerHour", "DCChargingPower", "DCChargingEnergyIn",
                "ACChargingPower", "ACChargingEnergyIn", "EnergyRemaining", "EstBatteryRange",
                "IdealBatteryRange", "RatedRange", "PackVoltage", "PackCurrent", "ChargePortDoorOpen",
                "ChargePortLatch", "ChargePortColdWeatherMode", "ChargingCableType", "FastChargerPresent",
                "FastChargerType", "TimeToFullCharge", "EstimatedHoursToChargeTermination",
                "ExpectedEnergyPercentAtTripArrival", "SuperchargerSessionTripPlanner",
                "ScheduledChargingMode", "ScheduledChargingPending", "ScheduledChargingStartTime",
                "ScheduledDepartureTime", "PreconditioningEnabled", "BrickVoltageMax", "BrickVoltageMin",
                "NumBrickVoltageMax", "NumBrickVoltageMin", "ModuleTempMax", "ModuleTempMin",
                "NumModuleTempMax", "NumModuleTempMin", "BatteryHeaterOn", "NotEnoughPowerToHeat", "BMSState",
                "BmsFullchargecomplete", "DCDCEnable", "IsolationResistance", "LifetimeEnergyUsed"
            ]
        ),
        FleetSignalCategory(
            name: "Powershare",
            fields: [
                "PowershareStatus", "PowershareType", "PowershareStopReason", "PowershareHoursLeft",
                "PowershareInstantaneousPowerKW"
            ]
        ),
        FleetSignalCategory(
            name: "Climate",
            fields: [
                "InsideTemp", "OutsideTemp", "HvacFanSpeed", "HvacFanStatus", "HvacPower", "HvacACEnabled",
                "HvacAutoMode", "HvacLeftTemperatureRequest", "HvacRightTemperatureRequest",
                "HvacSteeringWheelHeatAuto", "HvacSteeringWheelHeatLevel", "ClimateKeeperMode", "DefrostMode",
                "DefrostForPreconditioning", "CabinOverheatProtectionMode",
                "CabinOverheatProtectionTemperatureLimit", "SeatHeaterLeft", "SeatHeaterRight",
                "SeatHeaterRearLeft", "SeatHeaterRearCenter", "SeatHeaterRearRight", "SeatVentEnabled",
                "ClimateSeatCoolingFrontLeft", "ClimateSeatCoolingFrontRight", "AutoSeatClimateLeft",
                "AutoSeatClimateRight", "RearDefrostEnabled", "RearDisplayHvacEnabled", "WiperHeatEnabled"
            ]
        ),
        FleetSignalCategory(
            name: "Vehicle State",
            fields: [
                "Locked", "SentryMode", "DoorState", "FdWindow", "FpWindow", "RdWindow", "RpWindow",
                "Odometer", "HomelinkNearby", "HomelinkDeviceCount", "GuestModeEnabled",
                "GuestModeMobileAccessState", "DriverSeatOccupied", "CenterDisplay", "CurrentLimitMph",
                "SpeedLimitMode", "ValetModeEnabled", "ServiceMode", "PairedPhoneKeyAndKeyFobQty",
                "LightsHazardsActive", "LightsHighBeams", "LightsTurnSignal", "TonneauPosition",
                "TonneauOpenPercent", "TonneauTentMode"
            ]
        ),
        FleetSignalCategory(
            name: "Safety",
            fields: [
                "DriverSeatBelt", "PassengerSeatBelt", "AutomaticEmergencyBrakingOff",
                "AutomaticBlindSpotCamera", "BlindSpotCollisionWarningChime", "CruiseFollowDistance",
                "EmergencyLaneDepartureAvoidance", "ForwardCollisionWarning", "LaneDepartureAvoidance",
                "SpeedLimitWarning", "PinToDriveEnabled", "MilesSinceReset", "SelfDrivingMilesSinceReset"
            ]
        ),
        FleetSignalCategory(
            name: "Powertrain",
            fields: [
                "DiTorquemotor", "DiTorqueActualR", "DiTorqueActualF", "DiTorqueActualREL",
                "DiTorqueActualRER", "DiSlaveTorqueCmd", "DiAxleSpeedF", "DiAxleSpeedR", "DiAxleSpeedREL",
                "DiAxleSpeedRER", "DiStateR", "DiStateF", "DiStateREL", "DiStateRER", "DiStatorTempR",
                "DiStatorTempF", "DiStatorTempREL", "DiStatorTempRER", "DiHeatsinkTR", "DiHeatsinkTF",
                "DiHeatsinkTREL", "DiHeatsinkTRER", "DiInverterTR", "DiInverterTF", "DiInverterTREL",
                "DiInverterTRER", "DiMotorCurrentR", "DiMotorCurrentF", "DiMotorCurrentREL",
                "DiMotorCurrentRER", "DiVBatR", "DiVBatF", "DiVBatREL", "DiVBatRER", "Hvil"
            ]
        ),
        FleetSignalCategory(
            name: "Tires & Service",
            fields: [
                "TpmsPressureFl", "TpmsPressureFr", "TpmsPressureRl", "TpmsPressureRr", "TpmsHardWarnings",
                "TpmsSoftWarnings", "TpmsLastSeenPressureTimeFl", "TpmsLastSeenPressureTimeFr",
                "TpmsLastSeenPressureTimeRl", "TpmsLastSeenPressureTimeRr"
            ]
        ),
        FleetSignalCategory(
            name: "Media",
            fields: [
                "MediaNowPlayingTitle", "MediaNowPlayingArtist", "MediaNowPlayingAlbum",
                "MediaNowPlayingStation", "MediaNowPlayingDuration", "MediaNowPlayingElapsed",
                "MediaPlaybackStatus", "MediaPlaybackSource", "MediaAudioVolume", "MediaAudioVolumeIncrement",
                "MediaAudioVolumeMax"
            ]
        ),
        FleetSignalCategory(
            name: "User Preference",
            fields: [
                "Setting24HourTime", "SettingChargeUnit", "SettingDistanceUnit", "SettingTemperatureUnit",
                "SettingTirePressureUnit"
            ]
        ),
        FleetSignalCategory(
            name: "Vehicle Config",
            fields: [
                "CarType", "Trim", "ExteriorColor", "RoofColor", "WheelType", "VehicleName", "Version",
                "RearSeatHeaters", "SunroofInstalled", "EfficiencyPackage", "EuropeVehicle", "RightHandDrive",
                "RemoteStartEnabled", "ChargePort", "OffroadLightbarPresent", "SoftwareUpdateVersion",
                "SoftwareUpdateDownloadPercentComplete", "SoftwareUpdateInstallationPercentComplete",
                "SoftwareUpdateExpectedDurationMinutes", "SoftwareUpdateScheduledStartTime"
            ]
        )
    ]

    /// Filters the catalog by a case-insensitive field query, dropping empties.
    public static func filtered(_ query: String) -> [FleetSignalCategory] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return categories }
        return categories.compactMap { category in
            let matches = category.fields.filter { $0.lowercased().contains(trimmed) }
            return matches.isEmpty ? nil : FleetSignalCategory(name: category.name, fields: matches)
        }
    }
}

// MARK: - Signal selection sheet (native mapping of SignalConfigModal)

/// A signal-selection sheet: a streaming-interval stepper, a searchable list of
/// categories with per-field toggles, and confirm / cancel controls.
struct FleetSignalConfigSheet: View {
    let initialSelected: [String]
    let initialInterval: Int
    let onSubmit: ([String], Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String>
    @State private var interval: Int
    @State private var search = ""

    init(initialSelected: [String], initialInterval: Int, onSubmit: @escaping ([String], Int) -> Void) {
        self.initialSelected = initialSelected
        self.initialInterval = initialInterval
        self.onSubmit = onSubmit
        _selected = State(initialValue: Set(initialSelected))
        _interval = State(initialValue: max(1, initialInterval))
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Stepper(value: $interval, in: 1 ... 3600, step: 5) {
                        Text(verbatim: FleetApiStrings.format(
                            "devtools.fleet.intervalLabel", "Interval: %@", "\(interval)s"
                        ))
                        .font(Font.TS.body)
                    }
                    .accessibilityLabel(FleetApiStrings.text("devtools.fleet.intervalA11y", "Streaming interval"))
                }
                ForEach(FleetTelemetryFields.filtered(search)) { category in
                    Section(header: Text(verbatim: category.name)) {
                        ForEach(category.fields, id: \.self) { field in
                            Toggle(isOn: binding(for: field)) {
                                Text(verbatim: field).font(Font.TS.body)
                            }
                        }
                    }
                }
            }
            .searchable(
                text: $search,
                prompt: Text(verbatim: FleetApiStrings.string("devtools.fleet.searchSignals", "Search signals"))
            )
            .navigationTitle(Text(verbatim: FleetApiStrings.string("Configure Signals", "Configure Signals")))
            .toolbar { toolbarContent }
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button { dismiss() } label: {
                FleetApiStrings.text("devtools.fleet.cancel", "Cancel")
            }
        }
        ToolbarItem(placement: .confirmationAction) {
            Button {
                onSubmit(Array(selected), interval)
                dismiss()
            } label: {
                FleetApiStrings.text("devtools.fleet.done", "Done")
            }
        }
    }

    private func binding(for field: String) -> Binding<Bool> {
        Binding(
            get: { selected.contains(field) },
            set: { isOn in
                if isOn { selected.insert(field) } else { selected.remove(field) }
            }
        )
    }
}
