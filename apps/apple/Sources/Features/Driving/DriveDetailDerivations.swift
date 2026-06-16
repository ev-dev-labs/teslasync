import Foundation

// MARK: - Pure derivations (web `useDriveDetailData` memos)

/// SwiftUI-free derivations mirroring the web `useDriveDetailData` hook, kept here so they are
/// unit-testable independently of the view.
public enum DriveDetailDerivations {
    // Web route-map speed thresholds in SI m/s (constants.ts: 30 / 60 / 100 mph).
    static let speedSegmentLowMps = 30 * 0.44704
    static let speedSegmentMedMps = 60 * 0.44704
    static let speedSegmentHighMps = 100 * 0.44704

    /// Web chart/stat source precedence: telemetry if present, else positions.
    public static func chartSamples(_ record: DriveDetailRecord) -> [DriveTelemetrySample] {
        record.telemetry.isEmpty ? record.positions : record.telemetry
    }

    /// Web route source: telemetry coords if present (and non-null-island), else positions.
    public static func routeCoordinates(_ record: DriveDetailRecord) -> [DriveRouteCoordinate] {
        let source = record.telemetry.isEmpty ? record.positions : record.telemetry
        return source.compactMap { sample in
            guard let lat = sample.latitude, let lon = sample.longitude else { return nil }
            if lat == 0, lon == 0 { return nil }
            return DriveRouteCoordinate(latitude: lat, longitude: lon, speedMps: sample.speedMps ?? 0)
        }
    }

    /// Web speed-segment colour band for a sample speed (m/s).
    public static func speedBand(_ speedMps: Double) -> DriveSpeedBand {
        if speedMps >= speedSegmentHighMps { return .veryHigh }
        if speedMps >= speedSegmentMedMps { return .high }
        if speedMps >= speedSegmentLowMps { return .medium }
        return .low
    }

    /// Web `hasTelemetryRows || meaningful aggregates` gate that swaps the four numeric panels
    /// for the no-telemetry banner.
    public static func hasMeaningfulDriveStats(_ record: DriveDetailRecord, _ stats: DriveStats) -> Bool {
        let hasRows = !record.telemetry.isEmpty || !record.positions.isEmpty
        return record.distanceM > 0 || stats.maxSpeedMps > 0 || stats.energyWh > 0 || hasRows
    }

    /// Web `durationMinutes` helper used by gauges/timeline.
    public static func durationMinutes(_ record: DriveDetailRecord) -> Double {
        record.durationS / 60
    }

    /// Web `stats` memo, computed in SI. `samples` is `chartSamples(record)`.
    public static func stats(_ record: DriveDetailRecord, samples: [DriveTelemetrySample]) -> DriveStats {
        let movingSpeeds = samples.compactMap(\.speedMps).filter { $0 > 0 }
        let powers = samples.compactMap(\.powerW).filter { $0 != 0 }

        let avgPowerW = record.avgPowerW
            ?? (samples.isEmpty ? 0 : samples.compactMap(\.powerW).reduce(0, +) / Double(samples.count))
        let durationH = record.durationS / 3600
        let energyWh = record.energyUsedWh ?? (abs(avgPowerW) * durationH)
        let regenWh = record.regenEnergyWh ?? regenFromSamples(samples, durationH: durationH)

        let (elevGain, elevLoss) = elevationDeltas(samples)
        let outside = samples.compactMap(\.outsideTempC)
        let inside = samples.compactMap(\.insideTempC)
        let driver = samples.compactMap(\.driverTempC)
        let passenger = samples.compactMap(\.passengerTempC)
        let fan = samples.compactMap(\.fanStatus)
        let climateOnCount = samples.count(where: { $0.climateOn == true })
        let climateOffCount = samples.count(where: { $0.climateOn == false })
        let (startRange, endRange) = rangeEndpoints(samples)
        let (odoStart, odoEnd) = odometerEndpoints(samples)

        return DriveStats(
            maxSpeedMps: record.maxSpeedMps ?? 0,
            avgSpeedMps: record.avgSpeedMps ?? 0,
            minSpeedMps: movingSpeeds.min() ?? 0,
            powerMaxW: powers.max() ?? max(avgPowerW, 0),
            powerMinW: powers.min() ?? 0,
            avgPowerW: avgPowerW,
            energyWh: energyWh,
            regenWh: regenWh,
            consumptionWhPerKm: record.distanceM > 0 ? energyWh / (record.distanceM / 1000) : 0,
            elevGainM: elevGain,
            elevLossM: elevLoss,
            avgOutsideTempC: average(outside),
            avgInsideTempC: average(inside),
            avgDriverTempC: average(driver),
            avgPassengerTempC: average(passenger),
            hasAnyTemp: !outside.isEmpty || !inside.isEmpty || !driver.isEmpty || !passenger.isEmpty,
            outsideTempCount: outside.count,
            insideTempCount: inside.count,
            driverTempCount: driver.count,
            passengerTempCount: passenger.count,
            climateStatus: climateStatus(onCount: climateOnCount, offCount: climateOffCount),
            avgFanSpeed: average(fan),
            maxFanSpeed: fan.max(),
            startRangeM: startRange,
            endRangeM: endRange,
            odometerStartM: odoStart,
            odometerEndM: odoEnd,
            hasTirePressure: hasTirePressure(samples),
            batteryUsedPct: batteryUsed(record)
        )
    }

    private static func hasTirePressure(_ samples: [DriveTelemetrySample]) -> Bool {
        samples.contains { sample in
            sample.tireFlKpa != nil || sample.tireFrKpa != nil
                || sample.tireRlKpa != nil || sample.tireRrKpa != nil
        }
    }

    /// Web speed histogram (fixed display-unit buckets, dropping empty ones). `displaySpeeds`
    /// are already converted to the user's speed unit by the caller.
    public static func speedHistogram(displaySpeeds: [Double]) -> [SpeedHistogramBucket] {
        guard !displaySpeeds.isEmpty else { return [] }
        let edges: [(Double, Double)] = [
            (0, 20), (20, 40), (40, 60), (60, 80), (80, 100), (100, 120), (120, 9999)
        ]
        var counts = [Int](repeating: 0, count: edges.count)
        for speed in displaySpeeds {
            if let index = edges.firstIndex(where: { speed >= $0.0 && speed < $0.1 }) {
                counts[index] += 1
            }
        }
        let total = Double(displaySpeeds.count)
        return zip(edges, counts).compactMap { edge, count in
            guard count > 0 else { return nil }
            let label = edge.1 >= 9999 ? "\(Int(edge.0))+" : "\(Int(edge.0))–\(Int(edge.1))"
            return SpeedHistogramBucket(range: label, pct: (Double(count) / total * 100).rounded())
        }
    }

    // MARK: Private helpers

    private static func regenFromSamples(_ samples: [DriveTelemetrySample], durationH: Double) -> Double {
        guard !samples.isEmpty else { return 0 }
        let regenPower = samples.compactMap(\.powerW).filter { $0 < 0 }.map(abs).reduce(0, +)
        return regenPower * (durationH / Double(samples.count))
    }

    private static func elevationDeltas(_ samples: [DriveTelemetrySample]) -> (gain: Double, loss: Double) {
        let elevations = samples.compactMap(\.elevationM)
        guard elevations.count > 1 else { return (0, 0) }
        var gain = 0.0
        var loss = 0.0
        for index in 1 ..< elevations.count {
            let diff = elevations[index] - elevations[index - 1]
            if diff > 0 { gain += diff } else { loss += abs(diff) }
        }
        return (gain, loss)
    }

    private static func rangeEndpoints(_ samples: [DriveTelemetrySample]) -> (start: Double?, end: Double?) {
        let withRange = samples.filter { $0.idealRangeM != nil || $0.ratedRangeM != nil }
        let start = withRange.first.flatMap { $0.idealRangeM ?? $0.ratedRangeM }
        let end = withRange.last.flatMap { $0.idealRangeM ?? $0.ratedRangeM }
        return (start, end)
    }

    private static func odometerEndpoints(_ samples: [DriveTelemetrySample]) -> (start: Double, end: Double) {
        let withOdo = samples.compactMap(\.odometerM).filter { $0 > 0 }
        return (withOdo.first ?? 0, withOdo.last ?? 0)
    }

    private static func climateStatus(onCount: Int, offCount: Int) -> DriveClimateStatus? {
        if onCount > 0 { return onCount >= offCount ? .on : .mostlyOff }
        if offCount > 0 { return .off }
        return nil
    }

    private static func batteryUsed(_ record: DriveDetailRecord) -> Double? {
        guard let start = record.startBatteryPct, let end = record.endBatteryPct else { return nil }
        return start - end
    }

    private static func average(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        return values.reduce(0, +) / Double(values.count)
    }
}
