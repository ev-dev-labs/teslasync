//
//  Drawer.Previews.swift
//  TeslaSync — P4 modal / dialog · 0013 · Drawer (Apple)
//
//  Xcode previews — one per state the surface produces: content (label/value rows), empty (no rows),
//  loading (skeleton), error (retry), and the stale / offline freshness variants, plus a leading-edge
//  and a headerless variant. Each renders over a sample backdrop so the scrim + panel read correctly.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentDrawerTelemetry: DrawerTelemetry {
        func viewOpened(surface _: String) {}
    }

    private enum DrawerPreviewData {
        /// A representative detail body (web `children` stand-in).
        static let items: [DrawerContentItem] = [
            DrawerContentItem(id: "odometer", label: "Odometer", value: "12,840 mi"),
            DrawerContentItem(id: "battery", label: "Battery", value: "78%"),
            DrawerContentItem(id: "range", label: "Range", value: "214 mi"),
            DrawerContentItem(id: "tpms", label: "Tire pressure", value: "42 psi")
        ]

        static func update(
            status: DrawerLoadStatus = .loaded,
            connection: DrawerConnection = .live,
            hasItems: Bool = true
        ) -> DrawerUpdate {
            DrawerUpdate(status: status, items: hasItems ? items : [], connection: connection)
        }
    }

    @MainActor
    private func drawerPreview(
        _ update: DrawerUpdate,
        title: String? = "Vehicle details",
        edge: DrawerEdge = .trailing,
        showsFooter: Bool = true
    ) -> some View {
        let model = DrawerModel(
            source: InMemoryDrawerSource(initial: update),
            title: title,
            edge: edge,
            showsFooter: showsFooter,
            telemetry: SilentDrawerTelemetry()
        )
        return ZStack {
            LinearGradient(
                colors: [Color.TS.bg, Color.TS.surface],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            Drawer(model: model)
        }
    }

    #Preview("Content") {
        drawerPreview(DrawerPreviewData.update())
    }

    #Preview("Empty") {
        drawerPreview(DrawerPreviewData.update(status: .loaded, hasItems: false))
    }

    #Preview("Loading") {
        drawerPreview(DrawerPreviewData.update(status: .loading, hasItems: false))
    }

    #Preview("Error") {
        drawerPreview(DrawerPreviewData.update(status: .failed("The request timed out"), hasItems: false))
    }

    #Preview("Stale") {
        drawerPreview(DrawerPreviewData.update(connection: .stale))
    }

    #Preview("Offline") {
        drawerPreview(DrawerPreviewData.update(connection: .offline))
    }

    #Preview("Leading edge") {
        drawerPreview(DrawerPreviewData.update(), edge: .leading)
    }

    #Preview("Headerless") {
        drawerPreview(DrawerPreviewData.update(), title: nil, showsFooter: false)
    }
#endif
