//
//  GeofenceDrawer.Previews.swift
//  TeslaSync — P4 modal/dialog · 0011 · GeofenceDrawer (Apple)
//
//  Xcode previews — one per state the surface produces: content (the live map + toolbar + saved
//  list), empty (no fences yet, the friendly hint beneath a live map), loading (first fetch), error
//  (load failed → retry), and the stale / offline freshness variants. Preview-only; excluded from
//  release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentGeofenceTelemetry: GeofenceDrawerTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't mutate a geofence store.
    private struct SilentGeofenceController: GeofenceDrawerController {
        func create(_: NewGeofence) {}
        func edit(id _: String, geofence _: NewGeofence) {}
        func delete(id _: String) {}
    }

    private enum GeofencePreviewData {
        static let fences: [GeofenceItem] = [
            GeofenceItem(id: "home", name: "Home", lat: 37.7749, lng: -122.4194, radius: 320),
            GeofenceItem(id: "work", name: "Work", lat: 37.7849, lng: -122.4094, radius: 180),
            GeofenceItem(id: "yard", name: "Yard", polygon: [
                GeofencePoint(lat: 37.790, lng: -122.410),
                GeofencePoint(lat: 37.792, lng: -122.405),
                GeofencePoint(lat: 37.789, lng: -122.402),
                GeofencePoint(lat: 37.787, lng: -122.407)
            ])
        ]

        static func update(
            status: GeofenceDrawerLoadStatus = .loaded,
            connection: GeofenceDrawerConnection = .live,
            fences: [GeofenceItem]? = GeofencePreviewData.fences
        ) -> GeofenceDrawerUpdate {
            GeofenceDrawerUpdate(
                status: status,
                fences: fences,
                modes: GeofenceDrawerMode.order,
                center: GeofencePoint(lat: 37.7749, lng: -122.4194),
                connection: connection
            )
        }
    }

    @MainActor
    private func geofencePreview(_ update: GeofenceDrawerUpdate) -> GeofenceDrawer {
        let model = GeofenceDrawerModel(
            source: InMemoryGeofenceDrawerSource(initial: update),
            telemetry: SilentGeofenceTelemetry(),
            controller: SilentGeofenceController()
        )
        return GeofenceDrawer(model: model)
    }

    #Preview("Content") {
        ScrollView { geofencePreview(GeofencePreviewData.update()).padding() }
    }

    #Preview("Empty") {
        ScrollView { geofencePreview(GeofencePreviewData.update(fences: [])).padding() }
    }

    #Preview("Loading") {
        geofencePreview(GeofencePreviewData.update(status: .loading, fences: nil)).padding()
    }

    #Preview("Error") {
        geofencePreview(GeofencePreviewData.update(status: .failed("Couldn't reach the server"), fences: nil))
            .padding()
    }

    #Preview("Stale") {
        ScrollView { geofencePreview(GeofencePreviewData.update(connection: .stale)).padding() }
    }

    #Preview("Offline") {
        ScrollView { geofencePreview(GeofencePreviewData.update(connection: .offline)).padding() }
    }
#endif
