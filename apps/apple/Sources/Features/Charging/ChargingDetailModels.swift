import Foundation

// Value types + pure derivations for the Charging detail surface (web
// `web/src/features/charging/pages/ChargingDetailPage.tsx`, route `/charging/:id`). The
// page reads four sources (web hooks `useChargingSessionDetail`, `useChargeTelemetry`,
// `useVehicle`, `useChargingTelemetryLatest`) and renders the completed session's hero
// gauges, battery progress, eight headline stats, the more-details panel, four charts
// (charge curve + the synced SoC/energy/range, temperature, and voltage/current time
// series), the live advanced-parameters panel, and the timestamps footer.
//
// Everything is stored in SI (Wh, W, m, °C, V, A — phase-42/48 canonical) and converted
// only at the SwiftUI render boundary via `Units` / the `TS*` formatter components
// (ADR-005). The pure derivations the web computes inline — `isDC`, `durationMinutes`,
// `kwhPerHour`, `costPerKwh`, `addedDistanceM`, the synthesized charge curve, and the
// charging-state badge tone — live here as SwiftUI-free, unit-tested functions.

// MARK: - Vehicle (web `useVehicle` → `GET /vehicles/{id}`)

/// The owning vehicle (web `vehicle.display_name`). Identity + label only, so it
/// round-trips verbatim (no SI measurements here).
public struct ChargingDetailVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String

    public init(id: Int64, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Session (web `useChargingSessionDetail` → `GET /charging/{id}`)

/// One completed charge session. Energy is SI Wh, power SI W, odometer SI m — converted
/// at the render boundary (web keeps these conversions in the page until the backend
/// fields are renamed; the Apple core already reads SI).
public struct ChargingSessionDetail: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let vehicleID: Int64
    public let startedAt: Date
    public let endedAt: Date?
    public let startSocPct: Double?
    public let endSocPct: Double?
    public let totalEnergyAddedWh: Double
    public let peakPowerW: Double?
    public let avgPowerW: Double?
    public let chargerType: String?
    public let startPlace: String?
    public let costDecimal: Double?
    public let costCurrency: String?
    public let endedStatus: String?
    public let odometerStartM: Double?
    public let odometerEndM: Double?

    public init(
        id: Int64,
        vehicleID: Int64,
        startedAt: Date,
        endedAt: Date?,
        startSocPct: Double?,
        endSocPct: Double?,
        totalEnergyAddedWh: Double,
        peakPowerW: Double?,
        avgPowerW: Double?,
        chargerType: String?,
        startPlace: String?,
        costDecimal: Double?,
        costCurrency: String?,
        endedStatus: String?,
        odometerStartM: Double?,
        odometerEndM: Double?
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.totalEnergyAddedWh = totalEnergyAddedWh
        self.peakPowerW = peakPowerW
        self.avgPowerW = avgPowerW
        self.chargerType = chargerType
        self.startPlace = startPlace
        self.costDecimal = costDecimal
        self.costCurrency = costCurrency
        self.endedStatus = endedStatus
        self.odometerStartM = odometerStartM
        self.odometerEndM = odometerEndM
    }
}

// MARK: - Telemetry reading (web `useChargeTelemetry` → `GET /charging/{sessionId}/telemetry`)

/// One charge-telemetry sample. Power is SI W, energy SI Wh, range SI m, temps SI °C,
/// voltage V, current A — all converted at the render boundary (web `power_kw` is treated
/// as instantaneous power; the Apple model stores it as SI watts and divides for the kW
/// charge-curve axis).
public struct ChargeTelemetryReading: Identifiable, Hashable, Sendable {
    public let id: String
    public let createdAt: Date
    public let batteryLevelPct: Double?
    public let powerW: Double?
    public let energyAddedWh: Double?
    public let ratedRangeM: Double?
    public let batteryTempC: Double?
    public let insideTempC: Double?
    public let outsideTempC: Double?
    public let voltageV: Double?
    public let currentA: Double?

    public init(
        id: String,
        createdAt: Date,
        batteryLevelPct: Double?,
        powerW: Double?,
        energyAddedWh: Double?,
        ratedRangeM: Double?,
        batteryTempC: Double?,
        insideTempC: Double?,
        outsideTempC: Double?,
        voltageV: Double?,
        currentA: Double?
    ) {
        self.id = id
        self.createdAt = createdAt
        self.batteryLevelPct = batteryLevelPct
        self.powerW = powerW
        self.energyAddedWh = energyAddedWh
        self.ratedRangeM = ratedRangeM
        self.batteryTempC = batteryTempC
        self.insideTempC = insideTempC
        self.outsideTempC = outsideTempC
        self.voltageV = voltageV
        self.currentA = currentA
    }
}

// MARK: - Live charging (web `useChargingTelemetryLatest` → `GET /charging-telemetry/latest`)

/// The latest live charging parameters for the session's vehicle (web `liveCharging`).
/// Despite their legacy suffixes the source fields are SI (power W, range m, rate m/h,
/// energy Wh — phase-48 R2); the view converts at the render boundary.
public struct ChargingTelemetryLatest: Hashable, Sendable {
    public let chargingState: String?
    public let chargerVoltageV: Double?
    public let chargerActualCurrentA: Double?
    public let chargerPilotCurrentA: Double?
    public let chargerPowerW: Double?
    public let chargerPhases: Int?
    public let batteryRangeM: Double?
    public let rangeAddedMetersPerHour: Double?
    public let chargeEnergyAddedWh: Double?

    public init(
        chargingState: String?,
        chargerVoltageV: Double?,
        chargerActualCurrentA: Double?,
        chargerPilotCurrentA: Double?,
        chargerPowerW: Double?,
        chargerPhases: Int?,
        batteryRangeM: Double?,
        rangeAddedMetersPerHour: Double?,
        chargeEnergyAddedWh: Double?
    ) {
        self.chargingState = chargingState
        self.chargerVoltageV = chargerVoltageV
        self.chargerActualCurrentA = chargerActualCurrentA
        self.chargerPilotCurrentA = chargerPilotCurrentA
        self.chargerPowerW = chargerPowerW
        self.chargerPhases = chargerPhases
        self.batteryRangeM = batteryRangeM
        self.rangeAddedMetersPerHour = rangeAddedMetersPerHour
        self.chargeEnergyAddedWh = chargeEnergyAddedWh
    }
}

// MARK: - Charge curve sample (web `chargeCurve` row → `{ soc, power }`)

/// A single power-vs-SoC sample for the charge-curve chart. `powerKw` is in kW (the axis
/// the web labels), derived from SI watts at build time.
public struct ChargeCurvePoint: Hashable, Sendable {
    public let soc: Double
    public let powerKw: Double

    public init(soc: Double, powerKw: Double) {
        self.soc = soc
        self.powerKw = powerKw
    }
}

// MARK: - Page phase (web `isLoading || !session ? Skeleton : body`)

/// The page's terminal phase. `.ready` is the web body (the session resolved; every panel
/// renders, each resolving its own success/empty). `.error` is a retryable failure of the
/// session fetch (web has no detail-level error region, so the Apple page adds a HIG
/// retry surface); `.loading` is the initial fetch (web `LoadingSkeleton`).
public enum ChargingDetailPhase: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}

// MARK: - Pure derivations (web page-local helpers)

/// SwiftUI-free derivations mirroring the web page's inline helpers verbatim, kept here so
/// they are unit-testable independently of the view.
public enum ChargingDetailDerivations {
    /// Web page-local `isDC`: a charger type that is present and not a sentinel marks a DC
    /// session (drives the DC/AC badge + the gauge maxima + the curve taper).
    public static func isDC(_ session: ChargingSessionDetail) -> Bool {
        let type = (session.chargerType ?? "").lowercased()
        return !type.isEmpty && type != "<invalid>" && type != "unknown"
    }

    /// Web `durationMinutes(started, ended)`: `0` when not ended or non-positive, else the
    /// rounded minute delta.
    public static func durationMinutes(_ started: Date, _ ended: Date?) -> Int {
        guard let ended else { return 0 }
        let seconds = ended.timeIntervalSince(started)
        guard seconds.isFinite, seconds > 0 else { return 0 }
        return Int((seconds / 60).rounded())
    }

    /// Web `distanceAddedM`: the positive odometer delta in metres, or `nil`.
    public static func addedDistanceM(_ session: ChargingSessionDetail) -> Double? {
        guard let start = session.odometerStartM, let end = session.odometerEndM else { return nil }
        let delta = end - start
        return delta > 0 ? delta : nil
    }

    /// Web `kwhPerHour`: average charge rate in kWh/h, or `nil` for a zero-length session.
    public static func kwhPerHour(_ session: ChargingSessionDetail) -> Double? {
        let minutes = durationMinutes(session.startedAt, session.endedAt)
        guard minutes > 0 else { return nil }
        return (session.totalEnergyAddedWh / 1000 / Double(minutes)) * 60
    }

    /// Web `costPerKwh`: session cost divided by energy (kWh), or `nil` when unavailable.
    public static func costPerKwh(_ session: ChargingSessionDetail) -> Double? {
        guard let cost = session.costDecimal, session.totalEnergyAddedWh > 0 else { return nil }
        return cost / (session.totalEnergyAddedWh / 1000)
    }

    /// Web `synthesizeCurve`: a plausible 21-point power-vs-SoC curve when telemetry is
    /// absent. DC sessions taper above 80 %; AC stays flat. Power is kW.
    public static func synthesizeCurve(_ session: ChargingSessionDetail) -> [ChargeCurvePoint] {
        let startSoc = session.startSocPct ?? 0
        let endSoc = session.endSocPct ?? 100
        let peakPowerKw = (session.peakPowerW ?? 50_000) / 1000
        let dc = isDC(session)
        let steps = 20
        return (0...steps).map { step in
            let pct = Double(step) / Double(steps)
            let soc = startSoc + (endSoc - startSoc) * pct
            let taper = dc && soc > 80 ? 1 - (soc - 80) / 40 : 1
            let power = (peakPowerKw * max(taper, 0.15) * 10).rounded() / 10
            return ChargeCurvePoint(soc: soc.rounded(), powerKw: power)
        }
    }

    /// Web `chargeCurve`: telemetry-derived power-vs-SoC samples (rows with both SoC and
    /// power), falling back to the synthesized curve when telemetry is empty.
    public static func chargeCurve(
        session: ChargingSessionDetail,
        telemetry: [ChargeTelemetryReading]
    ) -> [ChargeCurvePoint] {
        let measured = telemetry.compactMap { reading -> ChargeCurvePoint? in
            guard let soc = reading.batteryLevelPct, let watts = reading.powerW else { return nil }
            return ChargeCurvePoint(soc: soc, powerKw: abs(watts) / 1000)
        }
        return measured.isEmpty ? synthesizeCurve(session) : measured
    }
}

// MARK: - Charging-state badge tone (web `chargingStateVariant`)

/// Pure live-charging-state → badge-tone derivation mirroring the web page's inline
/// `chargingStateVariant` switch. Kept SwiftUI-free so it is unit-testable; the view
/// resolves the `TSTone` to a colour at render time.
public enum ChargingStateTone {
    /// Web `chargingStateVariant`: Charging/Starting → success; Complete → info;
    /// Stopped/NoPower → warning; Error → danger; otherwise → neutral.
    public static func tone(_ state: String?) -> TSTone {
        switch state {
        case "Charging", "Starting": .success
        case "Complete": .info
        case "Stopped", "NoPower": .warning
        case "Error": .danger
        default: .neutral
        }
    }
}
