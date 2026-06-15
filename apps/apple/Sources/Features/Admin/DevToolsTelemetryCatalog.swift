import SwiftUI

// MARK: - Telemetry signal-field reference catalog (web devtools `TELEMETRY_FIELDS`)

/// The Fleet Telemetry signal-field reference shown in the Telemetry tab. Field names
/// are Tesla proto identifiers — reproduced verbatim from the web `constants.ts`
/// (`TELEMETRY_FIELDS`), grouped by the same categories in the same order. Pure static
/// reference data (the live error feed is the separate FleetTelemetryCoverage unit).
public extension DevToolsCatalog {
    static let telemetryCategories: [DevToolsTelemetryCategory] = [
        DevToolsTelemetryCategory(
            id: "location",
            nameKey: "devtools.telemetry.category.location",
            fields: lines("""
            Location
            GpsHeading
            GpsState
            DestinationLocation
            DestinationName
            MilesToArrival
            MinutesToArrival
            RouteLine
            RouteLastUpdated
            OriginLocation
            LocatedAtHome
            LocatedAtWork
            LocatedAtFavorite
            """)
        ),
        DevToolsTelemetryCategory(
            id: "driving",
            nameKey: "devtools.telemetry.category.driving",
            fields: lines("""
            VehicleSpeed
            Gear
            CruiseSetSpeed
            BrakePedal
            BrakePedalPos
            PedalPosition
            DriveRail
            LateralAcceleration
            LongitudinalAcceleration
            RouteTrafficMinutesDelay
            LifetimeEnergyGainedRegen
            LifetimeEnergyUsedDrive
            """)
        ),
        DevToolsTelemetryCategory(
            id: "charging",
            nameKey: "devtools.telemetry.category.charging",
            fields: lines("""
            BatteryLevel
            Soc
            ChargeState
            DetailedChargeState
            ChargeLimitSoc
            ChargeAmps
            ChargeCurrentRequest
            ChargeCurrentRequestMax
            ChargeEnableRequest
            ChargerVoltage
            ChargerPhases
            ChargeRateMilePerHour
            DCChargingPower
            DCChargingEnergyIn
            ACChargingPower
            ACChargingEnergyIn
            EnergyRemaining
            EstBatteryRange
            IdealBatteryRange
            RatedRange
            PackVoltage
            PackCurrent
            ChargePortDoorOpen
            ChargePortLatch
            ChargePortColdWeatherMode
            ChargingCableType
            FastChargerPresent
            FastChargerType
            TimeToFullCharge
            EstimatedHoursToChargeTermination
            ExpectedEnergyPercentAtTripArrival
            SuperchargerSessionTripPlanner
            ScheduledChargingMode
            ScheduledChargingPending
            ScheduledChargingStartTime
            ScheduledDepartureTime
            PreconditioningEnabled
            BrickVoltageMax
            BrickVoltageMin
            NumBrickVoltageMax
            NumBrickVoltageMin
            ModuleTempMax
            ModuleTempMin
            NumModuleTempMax
            NumModuleTempMin
            BatteryHeaterOn
            NotEnoughPowerToHeat
            BMSState
            BmsFullchargecomplete
            DCDCEnable
            IsolationResistance
            LifetimeEnergyUsed
            """)
        ),
        DevToolsTelemetryCategory(
            id: "powershare",
            nameKey: "devtools.telemetry.category.powershare",
            fields: lines("""
            PowershareStatus
            PowershareType
            PowershareStopReason
            PowershareHoursLeft
            PowershareInstantaneousPowerKW
            """)
        ),
        DevToolsTelemetryCategory(
            id: "climate",
            nameKey: "devtools.telemetry.category.climate",
            fields: lines("""
            InsideTemp
            OutsideTemp
            HvacFanSpeed
            HvacFanStatus
            HvacPower
            HvacACEnabled
            HvacAutoMode
            HvacLeftTemperatureRequest
            HvacRightTemperatureRequest
            HvacSteeringWheelHeatAuto
            HvacSteeringWheelHeatLevel
            ClimateKeeperMode
            DefrostMode
            DefrostForPreconditioning
            CabinOverheatProtectionMode
            CabinOverheatProtectionTemperatureLimit
            SeatHeaterLeft
            SeatHeaterRight
            SeatHeaterRearLeft
            SeatHeaterRearCenter
            SeatHeaterRearRight
            SeatVentEnabled
            ClimateSeatCoolingFrontLeft
            ClimateSeatCoolingFrontRight
            AutoSeatClimateLeft
            AutoSeatClimateRight
            RearDefrostEnabled
            RearDisplayHvacEnabled
            WiperHeatEnabled
            """)
        ),
        DevToolsTelemetryCategory(
            id: "vehicleState",
            nameKey: "devtools.telemetry.category.vehicleState",
            fields: lines("""
            Locked
            SentryMode
            DoorState
            FdWindow
            FpWindow
            RdWindow
            RpWindow
            Odometer
            HomelinkNearby
            HomelinkDeviceCount
            GuestModeEnabled
            GuestModeMobileAccessState
            DriverSeatOccupied
            CenterDisplay
            CurrentLimitMph
            SpeedLimitMode
            ValetModeEnabled
            ServiceMode
            PairedPhoneKeyAndKeyFobQty
            LightsHazardsActive
            LightsHighBeams
            LightsTurnSignal
            TonneauPosition
            TonneauOpenPercent
            TonneauTentMode
            """)
        ),
        DevToolsTelemetryCategory(
            id: "safety",
            nameKey: "devtools.telemetry.category.safety",
            fields: lines("""
            DriverSeatBelt
            PassengerSeatBelt
            AutomaticEmergencyBrakingOff
            AutomaticBlindSpotCamera
            BlindSpotCollisionWarningChime
            CruiseFollowDistance
            EmergencyLaneDepartureAvoidance
            ForwardCollisionWarning
            LaneDepartureAvoidance
            SpeedLimitWarning
            PinToDriveEnabled
            MilesSinceReset
            SelfDrivingMilesSinceReset
            """)
        ),
        DevToolsTelemetryCategory(
            id: "powertrain",
            nameKey: "devtools.telemetry.category.powertrain",
            fields: lines("""
            DiTorquemotor
            DiTorqueActualR
            DiTorqueActualF
            DiTorqueActualREL
            DiTorqueActualRER
            DiSlaveTorqueCmd
            DiAxleSpeedF
            DiAxleSpeedR
            DiAxleSpeedREL
            DiAxleSpeedRER
            DiStateR
            DiStateF
            DiStateREL
            DiStateRER
            DiStatorTempR
            DiStatorTempF
            DiStatorTempREL
            DiStatorTempRER
            DiHeatsinkTR
            DiHeatsinkTF
            DiHeatsinkTREL
            DiHeatsinkTRER
            DiInverterTR
            DiInverterTF
            DiInverterTREL
            DiInverterTRER
            DiMotorCurrentR
            DiMotorCurrentF
            DiMotorCurrentREL
            DiMotorCurrentRER
            DiVBatR
            DiVBatF
            DiVBatREL
            DiVBatRER
            Hvil
            """)
        ),
        DevToolsTelemetryCategory(
            id: "tires",
            nameKey: "devtools.telemetry.category.tires",
            fields: lines("""
            TpmsPressureFl
            TpmsPressureFr
            TpmsPressureRl
            TpmsPressureRr
            TpmsHardWarnings
            TpmsSoftWarnings
            TpmsLastSeenPressureTimeFl
            TpmsLastSeenPressureTimeFr
            TpmsLastSeenPressureTimeRl
            TpmsLastSeenPressureTimeRr
            """)
        ),
        DevToolsTelemetryCategory(
            id: "media",
            nameKey: "devtools.telemetry.category.media",
            fields: lines("""
            MediaNowPlayingTitle
            MediaNowPlayingArtist
            MediaNowPlayingAlbum
            MediaNowPlayingStation
            MediaNowPlayingDuration
            MediaNowPlayingElapsed
            MediaPlaybackStatus
            MediaPlaybackSource
            MediaAudioVolume
            MediaAudioVolumeIncrement
            MediaAudioVolumeMax
            """)
        ),
        DevToolsTelemetryCategory(
            id: "userPreference",
            nameKey: "devtools.telemetry.category.userPreference",
            fields: lines("""
            Setting24HourTime
            SettingChargeUnit
            SettingDistanceUnit
            SettingTemperatureUnit
            SettingTirePressureUnit
            """)
        ),
        DevToolsTelemetryCategory(
            id: "vehicleConfig",
            nameKey: "devtools.telemetry.category.vehicleConfig",
            fields: lines("""
            CarType
            Trim
            ExteriorColor
            RoofColor
            WheelType
            VehicleName
            Version
            RearSeatHeaters
            SunroofInstalled
            EfficiencyPackage
            EuropeVehicle
            RightHandDrive
            RemoteStartEnabled
            ChargePort
            OffroadLightbarPresent
            SoftwareUpdateVersion
            SoftwareUpdateDownloadPercentComplete
            SoftwareUpdateInstallationPercentComplete
            SoftwareUpdateExpectedDurationMinutes
            SoftwareUpdateScheduledStartTime
            """)
        )
    ]

    /// Total signal fields across all categories (shown as a summary count).
    static var telemetryFieldTotal: Int {
        telemetryCategories.reduce(0) { $0 + $1.fieldCount }
    }

    /// Splits a newline block into trimmed, non-empty field names.
    private static func lines(_ block: String) -> [String] {
        block
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}
