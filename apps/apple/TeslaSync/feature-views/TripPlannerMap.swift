//
//  TripPlannerMap.swift
//  TeslaSync — P4 feature view · 0178 · TripPlannerMap (Apple)
//
//  The trip-planner route map — the SwiftUI parity of the web
//  features/driving/components/TripPlannerMap.tsx. Switches over the model's render
//  phase (loading skeleton / loaded map / friendly empty / hard error) and layers the
//  native freshness chrome when the live feed is stale or offline. The loaded map
//  draws the planned route (web `Polyline`), the origin / destination / charge-stop
//  pins (web `CircleMarker`s), frames the camera to fit them, shows a role legend, and
//  opens a callout (web `Popup`) on tap. Binds through `TripPlannerMapModel` (P1/S8);
//  no networking lives here.
//

import SwiftUI

/// The trip-planner route map. Renders every state from the web source plus the
/// native stale/offline chrome, and always shows a surface (never a blank box).
public struct TripPlannerMap: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TripPlannerMapSurface.slug

    @State private var model: TripPlannerMapModel
    @State private var selectedMarkerID: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameter model: the bound view-model (built over a `TripPlannerMapSource`).
    public init(model: TripPlannerMapModel) {
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
            TripPlannerMapSkeleton()
        case let .error(message):
            TripPlannerMapErrorView(message: message) { model.refresh() }
        case .empty:
            TripPlannerMapEmptyState()
        case .content:
            loadedMap
        }
    }

    // MARK: Loaded map

    private var loadedMap: some View {
        TripPlannerMapCanvas(
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
            TripPlannerMapLegendChip(projection: model.projection, localize: model.localize)
                .padding(TSSpacing.md)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: TripPlannerMapLabels.mapLabel(localize: model.localize)))
    }

    /// The stacked top overlays: the freshness chip (when not live) and the active
    /// marker callout (web popup).
    private var topOverlays: some View {
        VStack(spacing: TSSpacing.sm) {
            if !model.connection.isLive {
                TripPlannerMapFreshnessChip(connection: model.connection) { model.refresh() }
            }
            if let display = selectedCalloutDisplay {
                TripPlannerMapCallout(
                    display: display,
                    localize: model.localize,
                    onDismiss: { selectedMarkerID = nil }
                )
            }
        }
        .padding(TSSpacing.md)
    }

    // MARK: Derivations

    /// The callout content for the selected marker, or `nil` when nothing is selected
    /// (or the selection is no longer plotted after a refresh).
    private var selectedCalloutDisplay: TripPlannerMarkerDisplay? {
        guard let selectedMarkerID,
              let marker = model.projection.markers.first(where: { $0.id == selectedMarkerID })
        else { return nil }
        return TripPlannerMarkerDisplay.make(
            marker: marker,
            localize: model.localize,
            locale: model.displayLocale
        )
    }

    /// The VoiceOver label for a marker — the resolved name + role (and, for a charge
    /// stop, the SOC range), built through the i18n facade.
    private func markerAccessibilityLabel(for marker: TripPlannerMarker) -> String {
        TripPlannerMarkerDisplay.make(
            marker: marker,
            localize: model.localize,
            locale: model.displayLocale
        ).accessibilityLabel
    }
}
