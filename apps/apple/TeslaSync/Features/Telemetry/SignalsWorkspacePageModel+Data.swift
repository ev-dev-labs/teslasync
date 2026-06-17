//
//  SignalsWorkspacePageModel+Data.swift
//  TeslaSync — P4 feature view · P7 · SignalsWorkspacePage (Apple)
//
//  Catalog grouping, aggregate maths, the live-stream loop, and the KMP shared
//  core binding points (ADR-004). Kept in an extension so the model's main type
//  body stays focused on observable state + intent.
//

import Foundation

extension SignalsWorkspacePageModel {
    /// Catalog grouped into categories, filtered by the search box (web tree).
    func filteredCategories() -> [(category: SignalCategory, signals: [String])] {
        let needle = catalogSearch.trimmingCharacters(in: .whitespaces).lowercased()
        let pool = needle.isEmpty
            ? availableSignals
            : availableSignals.filter { $0.lowercased().contains(needle) }
        var groups: [(SignalCategory, [String])] = []
        var claimed = Set<String>()
        for category in categories {
            let matched = pool.filter { category.matches($0) }.sorted()
            for name in matched { claimed.insert(name) }
            if !matched.isEmpty { groups.append((category, matched)) }
        }
        let leftovers = pool.filter { !claimed.contains($0) }.sorted()
        if !leftovers.isEmpty {
            groups.append((SignalCategory(key: "other", title: "Other", prefixes: []), leftovers))
        }
        return groups
    }

    /// Per-signal min / max / avg / count over numeric samples (web WorkspaceSignalStat).
    func computeStats(from rows: [SignalHistoryEntry]) -> [WorkspaceSignalStat] {
        var bySignal: [String: [Double]] = [:]
        for row in rows {
            guard let numeric = row.value.numeric else { continue }
            bySignal[row.signal, default: []].append(numeric)
        }
        return bySignal.map { signal, values in
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

    /// KMP binding: subscribe to the shared SSE live-signal stream (ADR-009).
    /// The ticks below stand in for stream frames until
    /// AppContainer.liveSignalsFactory is wired; the lifecycle, rate accounting,
    /// rolling buffer and >2min staleness are production logic.
    func runLiveStream() async {
        liveConnected = true
        livePhase = .success
        var counter = 0
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(500))
            if Task.isCancelled { break }
            if livePaused { continue }
            counter += 1
            ingestLiveTick(counter)
        }
    }

    func ingestLiveTick(_ counter: Int) {
        let signals = selectedSignals.isEmpty ? Array(availableSignals.prefix(3)) : selectedSignals
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
        if liveTail.count > liveTailMax { liveTail = Array(liveTail.prefix(liveTailMax)) }
        liveChartPointCount += signals.count
        liveRate = signals.count * 2
        lastLiveUpdate = now
        liveStats = computeStats(fromBuffer: liveBuffer)
    }

    private func computeStats(fromBuffer buffer: [String: [Double]]) -> [WorkspaceSignalStat] {
        buffer.map { signal, values in
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

    // MARK: - Data source binding points (KMP shared core, ADR-004)

    /// useVehicles → GET /vehicles.
    func fetchVehicles() async -> [WorkspaceVehicle] {
        [
            WorkspaceVehicle(id: 1, displayName: "Model 3", vin: "5YJ3E1EA1KF000001"),
            WorkspaceVehicle(id: 2, displayName: "Model Y", vin: "5YJYGDEE5MF000002")
        ]
    }

    /// useSignals → GET /signals/{vehicleId}/available.
    func fetchAvailableSignals(vehicleID: Int64) async -> [String] {
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

    /// usePinned → GET /pinned?type=widget&context=signal-diff:vehicle:{id}.
    func fetchPinned(vehicleID: Int64) async -> Set<String> {
        guard vehicleID > 0 else { return [] }
        return ["BatteryLevel", "Odometer"]
    }

    /// useSignalDiffServer → GET /signals/{vehicleId}/diff?at_a&at_b&signals.
    func fetchDiff(vehicleID: Int64, atA: Date, atB: Date) async -> [WorkspaceDiffEntry] {
        guard vehicleID > 0 else { return [] }
        return [
            WorkspaceDiffEntry(
                name: "BatteryLevel", valueA: .number(82.5), valueB: .number(78.3),
                sourceA: "L1", sourceB: "L1"
            ),
            WorkspaceDiffEntry(
                name: "ChargeState", valueA: .text("Charging"), valueB: .text("Complete"),
                sourceA: "L2", sourceB: "L1"
            ),
            WorkspaceDiffEntry(
                name: "VehicleSpeed", valueA: .number(0), valueB: .number(29.3),
                sourceA: "LOG", sourceB: "L1"
            ),
            WorkspaceDiffEntry(
                name: "Odometer", valueA: .number(12_345.2), valueB: .number(12_367.8),
                sourceA: "L1", sourceB: "L1"
            ),
            WorkspaceDiffEntry(
                name: "TirePressureFL", valueA: .number(287.5), valueB: .number(286.1),
                sourceA: "L2", sourceB: "L2"
            ),
            WorkspaceDiffEntry(
                name: "SentryMode", valueA: .bool(false), valueB: .bool(true),
                sourceA: "L1", sourceB: "L1"
            )
        ]
    }

    /// useSignals history → GET /signals/{vehicleId}/{signal}/history?from&to.
    func fetchHistory(
        vehicleID: Int64,
        signals: [String],
        from: Date,
        to: Date
    ) async -> [SignalHistoryEntry] {
        guard vehicleID > 0, !signals.isEmpty else { return [] }
        var rows: [SignalHistoryEntry] = []
        let span = max(1, to.timeIntervalSince(from))
        for signal in signals {
            for step in 0..<24 {
                let fraction = Double(step) / 24
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

    /// useTogglePin → POST /pinned (pin) · DELETE /pinned/{id} (unpin).
    func persistPin(signal: String, pin: Bool, vehicleID: Int64) async -> Bool {
        vehicleID > 0 && !signal.isEmpty
    }
}
