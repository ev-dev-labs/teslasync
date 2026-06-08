//
//  EntriesTable.Previews.swift
//  TeslaSync — P4 feature view · 0027 · EntriesTable (Apple)
//
//  Xcode previews exercising every load state the surface renders, driven by a fixed
//  in-memory provider so no network or KMP store is involved.
//

#if DEBUG
    import SwiftUI

    /// A provider that emits one fixed state — the preview/test stand-in for the live store.
    @MainActor
    private final class FixedEntriesProvider: EntriesTableProvider {
        private let fixed: EntriesTableViewState
        init(_ fixed: EntriesTableViewState) {
            self.fixed = fixed
        }

        func start(onState: @escaping (EntriesTableViewState) -> Void) {
            onState(fixed)
        }

        func stop() {}
        func refresh() {}
    }

    private enum EntriesTablePreviewData {
        static let dtos: [DLQEntrySummaryDTO] = [
            DLQEntrySummaryDTO(
                id: 1,
                arrivedAt: "2026-06-07T12:04:31Z",
                dlqTopic: "dlq/telemetry",
                parsedReason: "codec_drop:unknown_enum",
                parsedVin: "5YJ3E1EA7KF000001",
                parsedSourceTopic: "telemetry/5YJ3.../v/VehicleSpeed",
                parsedRedeliveries: 3,
                replayable: true,
                rawPayloadSize: 1280,
                innerPayloadSize: 940
            ),
            DLQEntrySummaryDTO(
                id: 2,
                arrivedAt: "2026-06-07T11:58:02Z",
                dlqTopic: "dlq/telemetry",
                parsedReason: "schema_mismatch",
                parsedVin: nil,
                parsedSourceTopic: nil,
                parsedRedeliveries: nil,
                replayable: false,
                rawPayloadSize: 512,
                innerPayloadSize: 0
            ),
            DLQEntrySummaryDTO(
                id: 3,
                arrivedAt: "2026-06-07T09:12:45Z",
                dlqTopic: "dlq/telemetry",
                parsedReason: "payload_too_large",
                parsedVin: "5YJSA1E26MF000099",
                parsedSourceTopic: "telemetry/5YJS.../v/Location",
                parsedRedeliveries: 12,
                replayable: true,
                rawPayloadSize: 3_407_872,
                innerPayloadSize: 3_400_000
            )
        ]

        static var rows: [DLQEntryRow] {
            EntriesTableProjector.project(dtos, context: .fixed)
        }
    }

    @MainActor
    private func previewModel(_ state: EntriesTableViewState) -> EntriesTableModel {
        EntriesTableModel(provider: FixedEntriesProvider(state), initialState: state)
    }

    @MainActor
    private func previewSurface(_ state: EntriesTableViewState) -> some View {
        EntriesTable(model: previewModel(state), onInspect: { _ in })
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    #Preview("Loaded · fresh") {
        previewSurface(.loaded(EntriesTablePreviewData.rows, freshness: .fresh))
    }

    #Preview("Loaded · stale") {
        previewSurface(.loaded(EntriesTablePreviewData.rows, freshness: .stale))
    }

    #Preview("Loaded · offline (cached)") {
        previewSurface(.loaded(EntriesTablePreviewData.rows, freshness: .offline))
    }

    #Preview("Loading") {
        previewSurface(.loading(cached: nil))
    }

    #Preview("Loading · behind cache") {
        previewSurface(.loading(cached: EntriesTablePreviewData.rows))
    }

    #Preview("Empty · pipeline clean") {
        previewSurface(.empty(freshness: .fresh))
    }

    #Preview("Error") {
        previewSurface(.failed(message: nil, cached: nil))
    }

    #Preview("Error · behind cache") {
        previewSurface(.failed(message: nil, cached: EntriesTablePreviewData.rows))
    }
#endif
