import SwiftUI

// The trip-replay drive summary (web "Drive Summary" `GlassPanel`): the eight headline stat cards
// — distance, duration, efficiency, elevation gain / loss, max & avg speed, and the battery
// start→end. Every unit-bearing value formats at the render boundary through `Units` (ADR-005);
// the grid reflows for compact vs. regular width (web `grid-cols-2 sm:grid-cols-4`).

struct TripReplaySummarySection: View {
    let model: TripReplayPageModel
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    private var record: TripReplayRecord? {
        model.record
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("replay.summary.title")
                if let record {
                    LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                        TSStatCard(
                            title: "replay.summary.distance",
                            value: Units.formatDistance(record.distanceM, units),
                            systemImage: "road.lanes"
                        )
                        TSStatCard(
                            title: "replay.summary.duration",
                            value: TripReplayPageFormat.driveTime(minutes: record.durationS / 60),
                            systemImage: "clock"
                        )
                        TSStatCard(
                            title: "replay.summary.efficiency",
                            value: efficiencyValue(record),
                            systemImage: "chart.line.uptrend.xyaxis"
                        )
                        TSStatCard(
                            title: "replay.summary.elevGain",
                            value: TripReplayPageFormat.emptyValue,
                            systemImage: "arrow.up.right"
                        )
                        TSStatCard(
                            title: "replay.summary.elevLoss",
                            value: TripReplayPageFormat.emptyValue,
                            systemImage: "arrow.down.right"
                        )
                        TSStatCard(
                            title: "replay.summary.maxSpeed",
                            value: speedValue(record.maxSpeedMps),
                            systemImage: "gauge.high"
                        )
                        TSStatCard(
                            title: "replay.summary.avgSpeed",
                            value: speedValue(record.avgSpeedMps),
                            systemImage: "gauge.medium"
                        )
                        TSStatCard(
                            title: "replay.summary.battery",
                            value: batteryValue(record),
                            systemImage: "battery.100percent"
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Web `efficiency = ((startPct - endPct) / distanceUserUnit) * 1000`, labelled `Wh/km`
    /// regardless of the distance unit (web hardcodes the `Wh/km` suffix on this derived metric).
    private func efficiencyValue(_ record: TripReplayRecord) -> String {
        guard record.distanceM > 0,
              let start = record.startBatteryPct,
              let end = record.endBatteryPct
        else { return TripReplayPageFormat.emptyValue }
        let distanceUserUnit = Units.convertDistance(record.distanceM, units)
        guard distanceUserUnit > 0 else { return TripReplayPageFormat.emptyValue }
        let efficiency = ((start - end) / distanceUserUnit) * 1000
        return "\(TripReplayPageFormat.number(efficiency)) Wh/km"
    }

    private func speedValue(_ mps: Double?) -> String {
        guard let mps else { return TripReplayPageFormat.emptyValue }
        return Units.formatSpeed(mps, units)
    }

    private func batteryValue(_ record: TripReplayRecord) -> String {
        guard let start = record.startBatteryPct, let end = record.endBatteryPct else {
            return TripReplayPageFormat.emptyValue
        }
        return "\(TripReplayPageFormat.int(start))% → \(TripReplayPageFormat.int(end))%"
    }
}
