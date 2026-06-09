//
//  TeslaChargingSessionsMap.swift
//  TeslaSync — P4 feature view · 0120 · TeslaChargingSessionsMap (Apple)
//
//  The charging-sessions map — the SwiftUI parity of the web
//  features/charging/pages/TeslaChargingSessionsMap.tsx. Switches over the model's
//  render phase (loading skeleton / loaded map / friendly empty / hard error) and
//  layers the native freshness chrome when the live feed is stale or offline. The
//  loaded map plots every charging session that has a known location (web
//  `clusterPoints` over a Leaflet `MarkerCluster`), frames the camera to fit them,
//  shows a plotted-count chip, and opens a callout (web popup) on tap. Binds
//  through `TeslaChargingSessionsMapModel` (P1/S8); no networking lives here.
//

import SwiftUI

// MARK: - String facade `Text` helper (keeps the model layer SwiftUI-free)

public extension TeslaChargingSessionsMapStrings {
    /// A `Text` for a facade key, rendered verbatim so the resolved (possibly
    /// localized) value is never re-interpreted as a SwiftUI string key.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - TeslaChargingSessionsMap (the feature surface)

/// The charging-sessions map. Renders every state from the web source plus the
/// native stale/offline chrome, and always shows a surface (never a blank box).
public struct TeslaChargingSessionsMap: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TeslaChargingSessionsMapSurface.slug

    @State private var model: TeslaChargingSessionsMapModel
    @State private var selectedMarkerID: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameter model: the bound view-model (built over a `TeslaChargingSessionsMapSource`).
    public init(model: TeslaChargingSessionsMapModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.phase)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            TeslaChargingSessionsMapSkeleton()
        case let .error(message):
            TeslaChargingSessionsMapErrorView(message: message) { model.refresh() }
        case .empty:
            TeslaChargingSessionsMapEmptyState()
        case .loaded:
            loadedMap
        }
    }

    // MARK: Loaded map

    private var loadedMap: some View {
        TeslaChargingSessionsMapCanvas(
            projection: model.projection,
            selectedID: selectedMarkerID,
            accessibilityLabel: markerAccessibilityLabel,
            onSelect: { selectedMarkerID = $0 }
        )
        .frame(minHeight: 320)
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .overlay(alignment: .top) { topOverlays }
        .overlay(alignment: .bottomLeading) {
            TeslaChargingSessionsMapCountChip(count: model.projection.plottedCount, localize: model.localize)
                .padding(TSSpacing.md)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: TeslaChargingSessionsMapLabels.mapLabel(localize: model.localize)))
    }

    /// The stacked top overlays: the freshness chip (when not live) and the active
    /// marker callout (web popup).
    private var topOverlays: some View {
        VStack(spacing: TSSpacing.sm) {
            if !model.connection.isLive {
                TeslaChargingSessionsMapFreshnessChip(connection: model.connection) { model.refresh() }
            }
            if let display = selectedCalloutDisplay {
                TeslaChargingSessionsMapCallout(
                    display: display,
                    localize: model.localize,
                    onDismiss: { selectedMarkerID = nil }
                )
            }
        }
        .padding(TSSpacing.md)
    }

    // MARK: Derivations

    /// The callout content for the selected marker, or `nil` when nothing is
    /// selected (or the selection is no longer plotted after a refresh).
    private var selectedCalloutDisplay: TeslaChargingSessionCalloutDisplay? {
        guard let selectedMarkerID,
              let marker = model.projection.markers.first(where: { $0.id == selectedMarkerID })
        else { return nil }
        return TeslaChargingSessionCalloutDisplay.make(
            marker: marker,
            formatting: model.formatting,
            localize: model.localize
        )
    }

    /// The VoiceOver label for a marker (web `ariaLabel`), resolving the site name
    /// (with the "Unknown" fallback) through the i18n facade.
    private func markerAccessibilityLabel(for marker: TeslaChargingSessionMarker) -> String {
        let name = TeslaChargingSessionsMapLabels.siteName(marker.siteLocationName, localize: model.localize)
        return TeslaChargingSessionsMapLabels.markerAccessibilityLabel(siteName: name, localize: model.localize)
    }
}
