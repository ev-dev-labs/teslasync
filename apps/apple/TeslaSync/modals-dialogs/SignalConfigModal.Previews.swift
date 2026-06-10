//
//  SignalConfigModal.Previews.swift
//  TeslaSync — P4 modal / dialog · 0016 · SignalConfigModal (Apple)
//
//  Xcode previews — one per state the surface produces: the populated config form (presets + master
//  bar + grouped list + footer), the in-list search-empty state, loading, empty (no catalog), error,
//  and the stale / offline freshness variants. Preview-only; excluded from release builds via
//  `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSignalConfigTelemetry: SignalConfigTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op action seam so previews don't log subscribe / cancel intents.
    private struct SilentSignalConfigActions: SignalConfigActions {
        func subscribe(_: [SignalConfigSubscription]) {}
        func cancel() {}
    }

    /// A representative slice of the Fleet Telemetry catalog spanning the preset category names, so
    /// the presets + grouping + interval tones are all exercised.
    private enum SignalConfigPreviewData {
        static func catalog() -> [SignalConfigCategoryCatalog] {
            [
                SignalConfigCategoryCatalog(
                    category: "Driving",
                    fields: ["VehicleSpeed", "Gear", "PedalPosition", "BrakePedal"]
                ),
                SignalConfigCategoryCatalog(
                    category: "Charging",
                    fields: ["BatteryLevel", "ChargeState", "ChargerVoltage", "ChargeAmps", "TimeToFullCharge"]
                ),
                SignalConfigCategoryCatalog(
                    category: "Location",
                    fields: ["Location", "GpsHeading", "DestinationName"]
                ),
                SignalConfigCategoryCatalog(
                    category: "Climate",
                    fields: ["InsideTemp", "OutsideTemp", "HvacPower"]
                ),
                SignalConfigCategoryCatalog(
                    category: "Powertrain",
                    fields: ["DiStatorTempR", "DiInverterTR", "DiMotorCurrentR"]
                ),
                SignalConfigCategoryCatalog(
                    category: "Vehicle Config",
                    fields: ["CarType", "Trim", "Version"]
                )
            ]
        }

        static func update(
            status: SignalConfigLoadStatus = .loaded,
            connection: SignalConfigConnection = .live,
            catalog: [SignalConfigCategoryCatalog] = catalog()
        ) -> SignalConfigUpdate {
            SignalConfigUpdate(
                status: status,
                catalog: catalog,
                initialSelected: ["VehicleSpeed", "BatteryLevel", "Location", "InsideTemp"],
                initialInterval: 10,
                connection: connection
            )
        }
    }

    @MainActor
    private func signalConfigModel(_ update: SignalConfigUpdate, search: String = "") -> SignalConfigModel {
        let model = SignalConfigModel(
            source: InMemorySignalConfigSource(initial: update),
            telemetry: SilentSignalConfigTelemetry(),
            actions: SilentSignalConfigActions()
        )
        model.start()
        if !search.isEmpty { model.setSearch(search) }
        return model
    }

    @MainActor
    private func signalConfigPreview(_ update: SignalConfigUpdate, search: String = "") -> some View {
        SignalConfigModal(model: signalConfigModel(update, search: search))
            .frame(width: 420, height: 620)
            .background(Color.TS.bg)
    }

    #Preview("Populated") {
        signalConfigPreview(SignalConfigPreviewData.update())
    }

    #Preview("Search · no matches") {
        signalConfigPreview(SignalConfigPreviewData.update(), search: "zzz-no-match")
    }

    #Preview("Loading") {
        signalConfigPreview(SignalConfigPreviewData.update(status: .loading, catalog: []))
    }

    #Preview("Empty · no catalog") {
        signalConfigPreview(SignalConfigPreviewData.update(status: .loaded, catalog: []))
    }

    #Preview("Error") {
        signalConfigPreview(SignalConfigPreviewData.update(status: .failed("Request timed out"), catalog: []))
    }

    #Preview("Stale") {
        signalConfigPreview(SignalConfigPreviewData.update(connection: .stale))
    }

    #Preview("Offline") {
        signalConfigPreview(SignalConfigPreviewData.update(connection: .offline))
    }
#endif
