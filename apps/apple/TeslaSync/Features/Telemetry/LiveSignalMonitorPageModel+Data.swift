//
//  LiveSignalMonitorPageModel+Data.swift
//  TeslaSync — P4-APPLE · P7 · page:telemetry/LiveSignalMonitor (Apple)
//
//  The live-stream pump loop plus the KMP shared-core binding points (ADR-004).
//  Kept in an extension so the model's main type stays focused on observable
//  state + intent. The default collaborators below are the production stand-ins
//  the View constructs; tests inject deterministic doubles instead.
//

import Foundation

extension LiveSignalMonitorPageModel {
    /// Opens the subscription then folds frames into the tail every 500 ms until
    /// the bound `.task` is cancelled. Rate, rolling 500-row buffer and >2 min
    /// freshness are production logic; `stream.frame` supplies the samples.
    func runLiveStream() async {
        guard await openStream() else { return }
        var tick = 0
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(500))
            if Task.isCancelled { break }
            if tailPaused { continue }
            tick += 1
            let now = Date()
            ingest(stream.frame(tick: tick, at: now), at: now)
        }
        connected = false
    }
}

// MARK: - Default vehicle source (web useVehicles → GET /vehicles)

/// Fleet snapshot the View uses until `AppContainer` wires the generated client
/// (ADR-003/ADR-004). Swapped for a stub in tests.
struct SampleLiveSignalMonitorVehicleSource: LiveSignalMonitorVehicleSource {
    func load() async throws -> [WorkspaceVehicle] {
        [
            WorkspaceVehicle(id: 1, displayName: "Model 3", vin: "5YJ3E1EA1KF000001"),
            WorkspaceVehicle(id: 2, displayName: "Model Y", vin: "5YJYGDEE5MF000002")
        ]
    }
}

// MARK: - Default live stream (web useLiveSignalStream → SSE, ADR-009)

/// Stands in for the shared-core SSE frames until `AppContainer.liveSignalsFactory`
/// is wired (ADR-004/ADR-009). The lifecycle, rate accounting, rolling buffer and
/// staleness in the model are production logic; this only supplies sample frames.
/// Each tick emits a rotating slice of the signal catalog with mixed value kinds
/// (numeric / textual / boolean) so the tail's type column is exercised.
struct SimulatedLiveSignalStream: LiveSignalStreamProviding {
    private static let catalog: [(signal: String, kind: SignalKind)] = [
        ("BatteryLevel", .number(base: 60, span: 40)),
        ("VehicleSpeed", .number(base: 30, span: 60)),
        ("PowerKw", .number(base: 0, span: 120)),
        ("CabinTemp", .number(base: 21, span: 6)),
        ("Odometer", .number(base: 12_000, span: 500)),
        ("ChargeState", .text(["Charging", "Complete", "Disconnected"])),
        ("Gear", .text(["P", "R", "N", "D"])),
        ("SentryMode", .bool),
        ("Locked", .bool)
    ]

    enum SignalKind: Sendable {
        case number(base: Double, span: Double)
        case text([String])
        case bool
    }

    func open(vehicleID _: Int64) async throws {}

    func frame(tick: Int, at now: Date) -> [LiveTailEntry] {
        // Three rotating signals per tick — the same shape a burst of SSE frames
        // arrives in. Values are deterministic in `tick` so previews are stable.
        let count = Self.catalog.count
        return (0..<3).map { offset in
            let index = (tick + offset) % count
            let entry = Self.catalog[index]
            return LiveTailEntry(
                id: "\(entry.signal)-\(tick)-\(offset)",
                signal: entry.signal,
                timestamp: now,
                value: Self.sample(entry.kind, tick: tick)
            )
        }
    }

    private static func sample(_ kind: SignalKind, tick: Int) -> WorkspaceSignalValue {
        switch kind {
        case let .number(base, span):
            return .number(base + span * (0.5 + 0.5 * sin(Double(tick) / 6)))
        case let .text(options):
            return .text(options[tick % options.count])
        case .bool:
            return .bool(tick.isMultiple(of: 2))
        }
    }
}
