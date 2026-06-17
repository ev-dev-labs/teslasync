//
//  SignalExplorerPageModel+Data.swift
//  TeslaSync — P4 feature view · P7 · SignalExplorerPage (Apple)
//
//  Aggregate maths, the live-stream loop, and the KMP shared-core binding points
//  (ADR-004). Kept in an extension so the model's main type body stays focused on
//  observable state + intent. The fetch seams stand in for the generated client
//  until `AppContainer` wires the shared core; the lifecycle, capping, stats, and
//  >2-min staleness around them are production logic.
//

import Foundation

extension SignalExplorerPageModel {
    // MARK: - Aggregate maths (web historicalStats / chartStats useMemo)

    /// Per-signal min / max / avg / count over numeric samples (web `SignalStat`).
    func computeStats(from rows: [SignalHistoryEntry]) -> [WorkspaceSignalStat] {
        var bySignal: [String: [Double]] = [:]
        for row in rows {
            guard let numeric = row.value.numeric else { continue }
            bySignal[row.signal, default: []].append(numeric)
        }
        return bySignal
            .map { signal, values in
                WorkspaceSignalStat(
                    signal: signal,
                    min: values.min() ?? 0,
                    max: values.max() ?? 0,
                    avg: values.reduce(0, +) / Double(values.count),
                    count: values.count
                )
            }
            .sorted { $0.signal < $1.signal }
    }

    /// The most recent sample for a signal in the live tail (web latest-value chip).
    func latestLiveValue(for signal: String) -> WorkspaceSignalValue? {
        liveTail.first { $0.signal == signal }?.value
    }

    // MARK: - Live stream (web useLiveSignalStream)

    /// KMP binding: subscribe to the shared SSE live-signal stream (ADR-009). The
    /// ticks below stand in for stream frames until `AppContainer.liveSignalsFactory`
    /// is wired; the connection lifecycle, rate accounting, rolling buffer, and the
    /// >2-min staleness flag are production logic.
    func runLiveStream() async {
        liveConnected = true
        var counter = 0
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(500))
            if Task.isCancelled { break }
            counter += 1
            ingestLiveTick(counter)
        }
    }

    private func ingestLiveTick(_ counter: Int) {
        let signals = selectedSignals.isEmpty
            ? Array(availableSignals.prefix(3))
            : selectedSignals
        guard !signals.isEmpty else { return }
        let now = Date()
        for signal in signals {
            let value = 50 + 40 * sin(Double(counter) / 6 + Double(signal.hashValue % 7))
            let entry = LiveTailEntry(
                id: "\(signal)-\(counter)",
                signal: signal,
                timestamp: now,
                value: .number(value)
            )
            liveTail.insert(entry, at: 0)
            liveBuffer[signal, default: []].append(value)
        }
        if liveTail.count > liveTailMax {
            liveTail = Array(liveTail.prefix(liveTailMax))
        }
        liveChartPointCount += signals.count
        liveRate = signals.count * 2
        lastLiveUpdate = now
        liveStats = computeStats(fromBuffer: liveBuffer)
    }

    private func computeStats(fromBuffer buffer: [String: [Double]]) -> [WorkspaceSignalStat] {
        buffer
            .map { signal, values in
                WorkspaceSignalStat(
                    signal: signal,
                    min: values.min() ?? 0,
                    max: values.max() ?? 0,
                    avg: values.reduce(0, +) / Double(values.count),
                    count: values.count
                )
            }
            .sorted { $0.signal < $1.signal }
    }

    // MARK: - Data-source binding points (KMP shared core, ADR-004)

    /// useVehicles → GET /vehicles.
    func fetchVehicles() async -> [WorkspaceVehicle] {
        [
            WorkspaceVehicle(id: 1, displayName: "Model 3", vin: "5YJ3E1EA1KF000001"),
            WorkspaceVehicle(id: 2, displayName: "Model Y", vin: "5YJYGDEE5MF000002")
        ]
    }

    /// useSignals → GET /signals/{vehicleId}/available. Throwing so the real
    /// binding can surface a failure into the catalog `error` phase.
    func fetchAvailableSignals(vehicleID: Int64) async throws -> [String] {
        guard vehicleID > 0 else { return [] }
        return [
            "BatteryLevel", "BatteryRange", "ChargeState", "ChargeRateMetersPerHour",
            "CabinTemp", "ClimateKeeperMode", "HvacPower",
            "VehicleSpeed", "Gear", "PedalPosition", "Odometer",
            "Location", "GpsHeading", "Latitude", "Longitude",
            "TirePressureFL", "TirePressureFR", "TpmsHard",
            "MediaVolume", "AudioState",
            "SentryMode", "LockState", "DoorState",
            "MotorRpmFront", "PowerKw", "TorqueNm"
        ]
    }

    /// useSignals history → GET /signals/{vehicleId}/{signal}/history?from&to&limit.
    func fetchHistory(
        vehicleID: Int64,
        signals: [String],
        from: Date,
        to: Date,
        limit: Int
    ) async throws -> [SignalHistoryEntry] {
        guard vehicleID > 0, !signals.isEmpty else { return [] }
        let steps = max(8, min(48, limit / max(1, signals.count)))
        let span = max(1, to.timeIntervalSince(from))
        var rows: [SignalHistoryEntry] = []
        for signal in signals {
            for step in 0 ..< steps {
                let fraction = Double(step) / Double(steps)
                let timestamp = from.addingTimeInterval(span * fraction)
                let value = 50 + 45 * sin(fraction * .pi * 2 + Double(signal.hashValue % 5))
                rows.append(
                    SignalHistoryEntry(
                        id: "\(signal)-\(step)",
                        signal: signal,
                        timestamp: timestamp,
                        value: .number(value)
                    )
                )
            }
        }
        return rows
    }
}
