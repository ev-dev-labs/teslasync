//
//  SessionListSection.Previews.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated,
//  bulk-enabled list), no-matches (a filter that excludes every row), empty (resolved
//  with no sessions), loading (initial skeleton), error (fetch failed → retry), and
//  the stale / offline freshness variants. Preview-only; excluded from release builds
//  via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSessionListTelemetry: SessionListTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A recording deleter so the bulk-action chrome renders in previews.
    @MainActor
    private final class PreviewSessionDeleter: SessionListDeleter {
        func delete(ids _: [Int]) async {}
    }

    /// Sample sessions spanning charger types, costs, SoC windows, and free charges.
    private enum SessionListPreviewData {
        static func items() -> [SessionListItem] {
            let now = Date(timeIntervalSince1970: 1_717_000_000)
            return [
                SessionListItem(
                    id: 1,
                    startedAt: now,
                    endedAt: now.addingTimeInterval(45 * 60),
                    startSocPct: 24,
                    endSocPct: 78,
                    energyAddedWh: 41200,
                    peakPowerW: 152_000,
                    avgPowerW: 96000,
                    costDecimal: 12.84,
                    costCurrency: "USD",
                    chargerType: "Supercharger V3",
                    startPlace: "Mountain View Supercharger",
                    odometerStartM: 1_000_000,
                    odometerEndM: 1_240_000
                ),
                SessionListItem(
                    id: 2,
                    startedAt: now.addingTimeInterval(-86400),
                    endedAt: now.addingTimeInterval(-86400 + 7 * 3600),
                    startSocPct: 41,
                    endSocPct: 90,
                    energyAddedWh: 33500,
                    peakPowerW: 11000,
                    avgPowerW: 7400,
                    costDecimal: 0,
                    chargerType: "Home AC Wall Connector",
                    startPlace: "Home"
                ),
                SessionListItem(
                    id: 3,
                    startedAt: now.addingTimeInterval(-2 * 86400),
                    endedAt: now.addingTimeInterval(-2 * 86400 + 32 * 60),
                    startSocPct: 18,
                    endSocPct: 62,
                    energyAddedWh: 28900,
                    peakPowerW: 88000,
                    avgPowerW: 60000,
                    costDecimal: 9.12,
                    chargerType: "CCS DC Fast",
                    startPlace: "Electrify America — Gilroy"
                )
            ]
        }

        static func update(
            status: SessionListLoadStatus = .loaded,
            connection: SessionListConnection = .live,
            empty: Bool = false
        ) -> SessionListUpdate {
            SessionListUpdate(
                status: status,
                items: empty ? [] : items(),
                connection: connection,
                exportContext: SessionExportContext(startDate: "2026-01-01", endDate: "2026-06-01", vehicleID: 7)
            )
        }
    }

    @MainActor
    private func sessionListPreview(
        _ update: SessionListUpdate,
        bulk: Bool = true,
        search: String = ""
    ) -> SessionListSection {
        let model = SessionListModel(
            source: InMemorySessionListSource(initial: update),
            telemetry: SilentSessionListTelemetry(),
            deleter: bulk ? PreviewSessionDeleter() : nil
        )
        if !search.isEmpty { model.setSearchQuery(search) }
        return SessionListSection(model: model)
    }

    #Preview("Content") {
        ScrollView { sessionListPreview(SessionListPreviewData.update()).padding() }
    }

    #Preview("No matches") {
        ScrollView {
            sessionListPreview(SessionListPreviewData.update(), search: "no-such-place").padding()
        }
    }

    #Preview("Empty") {
        sessionListPreview(SessionListPreviewData.update(empty: true)).padding()
    }

    #Preview("Loading") {
        sessionListPreview(SessionListPreviewData.update(status: .loading, empty: true)).padding()
    }

    #Preview("Error") {
        sessionListPreview(
            SessionListPreviewData.update(status: .failed("Request timed out"), empty: true)
        )
        .padding()
    }

    #Preview("Stale") {
        ScrollView {
            sessionListPreview(SessionListPreviewData.update(connection: .stale)).padding()
        }
    }

    #Preview("Offline") {
        ScrollView {
            sessionListPreview(SessionListPreviewData.update(connection: .offline)).padding()
        }
    }
#endif
