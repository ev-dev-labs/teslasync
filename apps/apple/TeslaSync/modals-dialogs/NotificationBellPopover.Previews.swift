//
//  NotificationBellPopover.Previews.swift
//  TeslaSync — P4 modal / dialog · 0010 · NotificationBellPopover (Apple)
//
//  Xcode previews — one per state the surface produces: the bell trigger (badge / 99+ / no badge),
//  the populated panel (mixed severities + a vehicle row), loading, empty ("all caught up"), error,
//  the inline-reload-error, and the stale / offline freshness variants. The loading / empty / error
//  previews render the panel directly so the chrome is visible without a popover anchor.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentNotificationBellTelemetry: NotificationBellTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample entries spanning the info / warn / critical severities, anchored to a fixed clock so
    /// the relative times are deterministic.
    private enum NotificationBellPreviewData {
        static let now = Date(timeIntervalSince1970: 1_717_000_000)

        static func entries() -> [NotificationBellEntry] {
            [
                NotificationBellEntry(
                    id: 1, severity: .critical, title: "Battery critically low",
                    ruleName: "Low battery", message: "State of charge dropped to 8%.",
                    createdAt: now.addingTimeInterval(-90), vehicleName: "Model 3"
                ),
                NotificationBellEntry(
                    id: 2, severity: .warn, title: nil, ruleName: "Tire pressure",
                    message: "Front-left tire below 38 psi.",
                    createdAt: now.addingTimeInterval(-3600), vehicleName: "Model Y"
                ),
                NotificationBellEntry(
                    id: 3, severity: .info, title: "Charging complete",
                    ruleName: "Charge done", message: nil,
                    createdAt: now.addingTimeInterval(-90000), vehicleName: nil
                )
            ]
        }

        static func update(
            status: NotificationBellLoadStatus = .loaded,
            connection: NotificationBellConnection = .live,
            count: Int = 3,
            rows: [NotificationBellEntry] = entries()
        ) -> NotificationBellUpdate {
            NotificationBellUpdate(status: status, count: count, entries: rows, connection: connection)
        }
    }

    @MainActor
    private func bellModel(_ update: NotificationBellUpdate) -> NotificationBellModel {
        let model = NotificationBellModel(
            source: InMemoryNotificationBellSource(initial: update),
            telemetry: SilentNotificationBellTelemetry(),
            now: { NotificationBellPreviewData.now }
        )
        model.start()
        return model
    }

    @MainActor
    private func bellPanelPreview(_ update: NotificationBellUpdate) -> some View {
        NotificationBellPanel(model: bellModel(update), onClose: {})
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Color.TS.bg)
    }

    #Preview("Trigger · badge") {
        NotificationBellPopover(model: bellModel(NotificationBellPreviewData.update(count: 3)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Trigger · 99+") {
        NotificationBellPopover(model: bellModel(NotificationBellPreviewData.update(count: 128)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Trigger · none") {
        NotificationBellPopover(
            model: bellModel(NotificationBellPreviewData.update(count: 0, rows: []))
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Panel · populated") {
        bellPanelPreview(NotificationBellPreviewData.update())
    }

    #Preview("Panel · loading") {
        bellPanelPreview(NotificationBellPreviewData.update(status: .loading, count: 0, rows: []))
    }

    #Preview("Panel · empty") {
        bellPanelPreview(NotificationBellPreviewData.update(count: 0, rows: []))
    }

    #Preview("Panel · error") {
        bellPanelPreview(
            NotificationBellPreviewData.update(status: .failed("Request timed out"), count: 2, rows: [])
        )
    }

    #Preview("Panel · stale") {
        bellPanelPreview(NotificationBellPreviewData.update(connection: .stale))
    }

    #Preview("Panel · offline") {
        bellPanelPreview(NotificationBellPreviewData.update(connection: .offline))
    }
#endif
