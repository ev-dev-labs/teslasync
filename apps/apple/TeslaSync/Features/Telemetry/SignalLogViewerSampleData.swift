import Foundation

/// A representative local seed used as the `SignalLogViewerPageModel` / preview default until the
/// KMP-backed source is injected at composition time (ADR-004). The catalog mirrors a typical Tesla
/// signal set; `loadHistory` synthesizes an API-response-shaped batch (numeric, string, and boolean
/// readings so every value-type badge renders) spread across the requested window and sorted
/// newest-first — exactly the shape the web `queryFn` produces after `adaptSignalHistoryResp`.
public struct SampleSignalLogViewerDataSource: SignalLogViewerDataSource {
    public init() {}

    private static let catalog: [String] = [
        "Odometer", "VehicleSpeed", "Gear", "BatteryLevel", "ChargeState",
        "Locked", "SentryMode", "InsideTemp", "OutsideTemp", "Soc",
        "ChargerPower", "EstBatteryRange", "TpmsPressureFl", "TpmsPressureFr"
    ]

    public func loadAvailableSignals(vehicleID: Int64) async throws -> [SignalLogViewerSignal] {
        guard vehicleID > 0 else { return [] }
        return Self.catalog.map(SignalLogViewerSignal.init(name:))
    }

    public func loadHistory(
        vehicleID: Int64,
        signals: [String],
        from: Date,
        to: Date,
        perPage: Int
    ) async throws -> [SignalLogEntry] {
        guard vehicleID > 0, !signals.isEmpty else { return [] }
        let span = max(60, to.timeIntervalSince(from))
        let perSignal = max(8, min(perPage, 40))
        let formatter = Self.makeISOFormatter()
        var rows: [SignalLogEntry] = []
        for signal in signals {
            for step in 0 ..< perSignal {
                let fraction = Double(step) / Double(perSignal)
                let instant = from.addingTimeInterval(span * fraction)
                rows.append(makeRow(signal: signal, instant: instant, step: step, formatter: formatter))
            }
        }
        return rows.sorted { $0.createdAt > $1.createdAt }
    }

    /// Routes a synthesized reading into the correct typed column based on the signal name so the
    /// table renders numeric, string, and boolean cells (and their type badges), matching the typed
    /// shape the real `/signals/{vid}/{name}/history` endpoint streams.
    private func makeRow(
        signal: String,
        instant: Date,
        step: Int,
        formatter: ISO8601DateFormatter
    ) -> SignalLogEntry {
        let timestamp = formatter.string(from: instant)
        switch Self.kind(of: signal) {
        case .boolean:
            return SignalLogEntry(createdAt: timestamp, signal: signal, valueBool: step.isMultiple(of: 2))
        case .string:
            let states = ["Drive", "Park", "Reverse", "Neutral"]
            let charge = ["Charging", "Complete", "Disconnected", "Stopped"]
            let pool = signal == "ChargeState" ? charge : states
            return SignalLogEntry(createdAt: timestamp, signal: signal, valueStr: pool[step % pool.count])
        case .number:
            let base = Double(abs(signal.hashValue % 50))
            let value = (base + 45 * sin(Double(step) / 6 + base)).rounded()
            return SignalLogEntry(createdAt: timestamp, signal: signal, valueNum: value)
        }
    }

    private enum Kind { case number, string, boolean }

    private static func kind(of signal: String) -> Kind {
        switch signal {
        case "Locked", "SentryMode": .boolean
        case "Gear", "ChargeState": .string
        default: .number
        }
    }

    /// A fresh ISO8601 (with fractional seconds, UTC) formatter — created per query rather than held
    /// as a shared global, since `ISO8601DateFormatter` is not `Sendable` (Swift 6 strict concurrency).
    private static func makeISOFormatter() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter
    }
}
