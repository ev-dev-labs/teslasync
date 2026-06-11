//
//  ExportModal.Previews.swift
//  TeslaSync — P4 modal / dialog · 0023 · ExportModal (Apple)
//
//  Xcode previews — one per state the surface produces: the populated export panel (mini grid + summary
//  + options), loading, empty (dashboard not found), error, the over-length share-URL warning, and the
//  stale / offline freshness variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentExportTelemetry: ExportTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op clipboard so previews don't touch the pasteboard.
    private struct SilentExportClipboard: ExportClipboard {
        func copy(_: String) {}
    }

    /// A no-op download action so previews don't log export intents.
    private struct SilentExportActions: ExportActions {
        func download(_: ExportDownloadRequest) {}
    }

    private enum ExportPreviewData {
        /// A fixed instant so the "Updated {date}" line is deterministic.
        static let updated = Date(timeIntervalSince1970: 1_767_268_800)

        static func widgets(_ count: Int) -> [ExportWidgetInstance] {
            (0 ..< count).map { index in
                ExportWidgetInstance(
                    id: "w\(index)",
                    widgetID: "widget-\(index)",
                    config: .object(["showTitle": .bool(true)])
                )
            }
        }

        static func layout() -> [ExportLayoutItem] {
            [
                ExportLayoutItem(itemID: "w0", x: 0, y: 0, width: 2, height: 2),
                ExportLayoutItem(itemID: "w1", x: 2, y: 0, width: 2, height: 2),
                ExportLayoutItem(itemID: "w2", x: 0, y: 2, width: 4, height: 2),
                ExportLayoutItem(itemID: "w3", x: 0, y: 4, width: 1, height: 1)
            ]
        }

        static func dashboard() -> DashboardExportDescriptor {
            DashboardExportDescriptor(
                id: "dash-1",
                name: "Garage Overview",
                icon: "🔋",
                widgets: widgets(4),
                layouts: ["lg": layout()],
                updatedAt: updated
            )
        }

        /// A deliberately huge dashboard so the share URL exceeds the 2000-character ceiling.
        static func hugeDashboard() -> DashboardExportDescriptor {
            let many = (0 ..< 400).map { index in
                ExportWidgetInstance(
                    id: "widget-instance-\(index)",
                    widgetID: "battery-health-detail",
                    config: .object(["label": .string(String(repeating: "x", count: 24))])
                )
            }
            let layout = (0 ..< 400).map { index in
                ExportLayoutItem(itemID: "widget-instance-\(index)", x: 0, y: index, width: 1, height: 1)
            }
            return DashboardExportDescriptor(
                id: "dash-huge",
                name: "Everything Dashboard",
                widgets: many,
                layouts: ["lg": layout],
                updatedAt: updated
            )
        }

        static func update(
            status: ExportLoadStatus = .loaded,
            connection: ExportConnection = .live,
            dashboard: DashboardExportDescriptor? = dashboard()
        ) -> ExportUpdate {
            ExportUpdate(status: status, dashboard: dashboard, connection: connection)
        }
    }

    @MainActor
    private func exportModel(_ update: ExportUpdate) -> ExportModel {
        let model = ExportModel(
            source: InMemoryExportSource(initial: update),
            telemetry: SilentExportTelemetry(),
            actions: SilentExportActions(),
            clipboard: SilentExportClipboard(),
            originProvider: DefaultExportURLOrigin(origin: "https://app.teslasync.io"),
            dates: DefaultExportDateFormatting(
                timeZone: TimeZone(identifier: "UTC") ?? .current,
                locale: Locale(identifier: "en_US")
            )
        )
        model.start()
        return model
    }

    @MainActor
    private func exportPreview(_ update: ExportUpdate) -> some View {
        ExportModal(model: exportModel(update))
            .frame(width: 460, height: 620)
            .background(Color.TS.bg)
    }

    #Preview("Populated") {
        exportPreview(ExportPreviewData.update())
    }

    #Preview("URL too long") {
        exportPreview(ExportPreviewData.update(dashboard: ExportPreviewData.hugeDashboard()))
    }

    #Preview("Loading") {
        exportPreview(ExportPreviewData.update(status: .loading, dashboard: nil))
    }

    #Preview("Empty · not found") {
        exportPreview(ExportPreviewData.update(status: .loaded, dashboard: nil))
    }

    #Preview("Error") {
        exportPreview(ExportPreviewData.update(status: .failed("Request timed out"), dashboard: nil))
    }

    #Preview("Stale") {
        exportPreview(ExportPreviewData.update(connection: .stale))
    }

    #Preview("Offline") {
        exportPreview(ExportPreviewData.update(connection: .offline))
    }
#endif
