import Foundation

/// A representative local seed used as the `BatteryCellsPage` / preview default
/// until the KMP-backed source is injected at composition time. It is NOT
/// production telemetry — it is an API-response-shaped fixture (one pack of 24
/// cells with a slight imbalance and one critical outlier, plus an eight-sample
/// history) so the surface renders its populated success state out of the box.
/// Voltages are volts and temperatures are SI Celsius; the view converts at the
/// render boundary.
public struct SampleBatteryCellsDataSource: BatteryCellsDataSource {
    public init() {}

    public func loadVehicles() async throws -> [BatteryVehicle] {
        [
            BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            BatteryVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002")
        ]
    }

    public func loadCellData(vehicleID _: Int64) async throws -> BatteryCellData? {
        let cells = SampleBatteryCellsDataSource.sampleCells()
        let voltages = cells.map(\.voltage)
        let minimum = voltages.min() ?? 0
        let maximum = voltages.max() ?? 0
        return BatteryCellData(
            totalCells: cells.count,
            avgVoltage: 3.700,
            minVoltage: minimum,
            maxVoltage: maximum,
            voltageSpread: maximum - minimum,
            imbalanceMv: (maximum - minimum) * 1000,
            packVoltage: 3.700 * Double(cells.count),
            avgTemperatureC: 24.5,
            minTemperatureC: 22.1,
            maxTemperatureC: 28.4,
            tempSpreadC: 6.3,
            cells: cells,
            history: SampleBatteryCellsDataSource.sampleHistory()
        )
    }

    /// 24 cells around a 3.700 V average — mostly nominal, with a low cell, a high
    /// cell, and one critical outlier so the heatmap tints, the status badges, and
    /// the critical-cell insight all exercise their populated branches.
    static func sampleCells() -> [BatteryCellReading] {
        let average = 3.700
        let nominalOffsets: [Double] = [0.001, -0.001, 0.002, -0.002, 0.000, 0.003, -0.003, 0.001]
        return (1 ... 24).map { index in
            let voltage: Double
            let status: BatteryCellStatus
            switch index {
            case 7:
                voltage = 3.690
                status = .low
            case 18:
                voltage = 3.710
                status = .high
            case 13:
                voltage = 3.681
                status = .critical
            default:
                voltage = average + nominalOffsets[index % nominalOffsets.count]
                status = .normal
            }
            return BatteryCellReading(
                cellID: index,
                voltage: voltage,
                deltaFromAvgV: voltage - average,
                status: status
            )
        }
    }

    /// Eight daily samples whose imbalance crosses the 5 mV / 15 mV bands so the
    /// reference lines and trend slope are meaningful.
    static func sampleHistory() -> [BatteryCellHistoryPoint] {
        let base = Date(timeIntervalSince1970: 1_717_200_000)
        let day: TimeInterval = 86400
        let samples: [HistorySample] = [
            HistorySample(min: 3.698, avg: 3.701, max: 3.704, imbalance: 6.0),
            HistorySample(min: 3.697, avg: 3.701, max: 3.705, imbalance: 8.0),
            HistorySample(min: 3.696, avg: 3.700, max: 3.706, imbalance: 10.0),
            HistorySample(min: 3.695, avg: 3.700, max: 3.707, imbalance: 12.0),
            HistorySample(min: 3.694, avg: 3.700, max: 3.709, imbalance: 15.0),
            HistorySample(min: 3.692, avg: 3.700, max: 3.710, imbalance: 18.0),
            HistorySample(min: 3.690, avg: 3.700, max: 3.711, imbalance: 21.0),
            HistorySample(min: 3.688, avg: 3.700, max: 3.713, imbalance: 25.0)
        ]
        return samples.enumerated().map { index, sample in
            BatteryCellHistoryPoint(
                timestamp: base.addingTimeInterval(Double(index) * day),
                minVoltage: sample.min,
                maxVoltage: sample.max,
                avgVoltage: sample.avg,
                imbalanceMv: sample.imbalance
            )
        }
    }

    /// One seeded history row (a named shape, not a wide tuple).
    private struct HistorySample {
        let min: Double
        let avg: Double
        let max: Double
        let imbalance: Double
    }
}

#if DEBUG
    /// Preview/test seam yielding a vehicle whose snapshot is nil — drives the
    /// page's no-data empty state (web `!data`).
    public struct EmptyBatteryCellsDataSource: BatteryCellsDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadCellData(vehicleID _: Int64) async throws -> BatteryCellData? {
            nil
        }
    }

    /// Preview/test seam yielding a populated snapshot with empty cells + history —
    /// drives every per-section empty state (heatmap, table, spread trend) while the
    /// page itself is `.ready`.
    public struct EmptySectionsBatteryCellsDataSource: BatteryCellsDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadCellData(vehicleID _: Int64) async throws -> BatteryCellData? {
            BatteryCellData(
                totalCells: 0,
                avgVoltage: 0,
                minVoltage: 0,
                maxVoltage: 0,
                voltageSpread: 0,
                imbalanceMv: 0,
                packVoltage: 0,
                avgTemperatureC: 0,
                minTemperatureC: 0,
                maxTemperatureC: 0,
                tempSpreadC: 0,
                cells: [],
                history: []
            )
        }
    }

    /// Preview/test seam whose cells load fails — drives the error state (web
    /// `PageContainer error`).
    public struct FailingBatteryCellsDataSource: BatteryCellsDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadCellData(vehicleID _: Int64) async throws -> BatteryCellData? {
            throw Failure()
        }
    }
#endif
