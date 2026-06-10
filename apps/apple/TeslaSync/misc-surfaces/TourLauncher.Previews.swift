//
//  TourLauncher.Previews.swift
//  TeslaSync — P4 misc surface · 0001 · TourLauncher (Apple)
//
//  Xcode previews — one per state the surface produces: content (the populated launcher with a
//  route-recommended row + completed badges), empty (resolved with no tours), loading (initial
//  spinner), error (load failed → retry), and the stale / offline freshness variants.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentTourLauncherTelemetry: TourLauncherTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't drive the tour engine.
    private struct SilentTourLauncherController: TourLauncherController {
        func startTour(id _: String) {}
        func markListSeen() {}
    }

    private enum TourLauncherPreviewData {
        /// The full registry with two tours already completed, viewed from `/vehicles` so the
        /// Vehicles row renders the "Recommended for this page" highlight.
        static func update(
            status: TourLauncherLoadStatus = .loaded,
            connection: TourLauncherConnection = .live,
            empty: Bool = false
        ) -> TourLauncherUpdate {
            TourLauncherUpdate(
                status: status,
                entries: empty ? [] : TourCatalog.all,
                completedIDs: empty ? [] : ["drives", "settings"],
                pathname: "/vehicles",
                connection: connection
            )
        }
    }

    @MainActor
    private func tourLauncherPreview(_ update: TourLauncherUpdate) -> TourLauncher {
        let model = TourLauncherModel(
            source: InMemoryTourLauncherSource(initial: update),
            telemetry: SilentTourLauncherTelemetry(),
            controller: SilentTourLauncherController()
        )
        return TourLauncher(model: model)
    }

    #Preview("Content") {
        ScrollView { tourLauncherPreview(TourLauncherPreviewData.update()).padding() }
    }

    #Preview("Empty") {
        tourLauncherPreview(TourLauncherPreviewData.update(empty: true)).padding()
    }

    #Preview("Loading") {
        tourLauncherPreview(TourLauncherPreviewData.update(status: .loading, empty: true)).padding()
    }

    #Preview("Error") {
        tourLauncherPreview(TourLauncherPreviewData.update(status: .failed("Couldn't load tours"), empty: true))
            .padding()
    }

    #Preview("Stale") {
        ScrollView { tourLauncherPreview(TourLauncherPreviewData.update(connection: .stale)).padding() }
    }

    #Preview("Offline") {
        ScrollView { tourLauncherPreview(TourLauncherPreviewData.update(connection: .offline)).padding() }
    }
#endif
