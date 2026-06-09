//
//  GeofenceWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0053 · GeofenceWidget (Apple)
//
//  The presentational sub-views the `GeofenceWidget` surface composes: a fence
//  list row, the membership badge (web `Badge`), and the MapKit canvas (web
//  `WidgetMapView` + `Circle`/`Marker`). Split out of GeofenceWidget.swift so each
//  file stays within the module's file-length budget. No data access lives here —
//  every value arrives from the bound `GeofenceWidgetProjection`.
//

import MapKit
import SwiftUI

// MARK: - Fence row (web `<li>`)

/// One fence list row — name + radius on the leading edge, the membership badge
/// trailing, with the active highlight when the vehicle is inside an enabled zone
/// (web `f.inside && f.enabled`).
struct GeofenceWidgetFenceRow: View {
    let fence: GeofenceWidgetFenceStatus

    private var radiusLabel: String {
        GeofenceWidgetStrings.string("widget.geofence.radius", "Radius")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: fence.name)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: "\(radiusLabel): \(fence.radiusText)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            badge
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(minHeight: 44)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowBackground)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(fence.isActive ? Color.TS.statusSuccess.opacity(0.3) : Color.clear, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: GeofenceWidgetAccessibility.rowLabel(fence)))
    }

    @ViewBuilder
    private var badge: some View {
        switch fence.membership {
        case .disabled:
            GeofenceWidgetMembershipBadge(
                text: GeofenceWidgetStrings.string("widget.geofence.disabled", "Disabled"),
                tone: .neutral
            )
        case .inside:
            GeofenceWidgetMembershipBadge(
                text: GeofenceWidgetStrings.string("widget.geofence.inside", "Inside"),
                tone: .success,
                showDot: true
            )
        case .outside:
            GeofenceWidgetMembershipBadge(
                text: GeofenceWidgetStrings.string("widget.geofence.outside", "Outside"),
                tone: .neutral
            )
        }
    }

    private var rowBackground: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(fence.isActive ? Color.TS.statusSuccess.opacity(0.1) : Color.TS.surfaceGlass)
    }
}

// MARK: - Membership badge (web `Badge`)

/// A compact tinted badge resolving a runtime-localized string (web `Badge`
/// variant `success`/`neutral`, with an optional leading dot for `Inside`).
struct GeofenceWidgetMembershipBadge: View {
    let text: String
    let tone: TSTone
    var showDot: Bool = false

    var body: some View {
        HStack(spacing: 4) {
            if showDot {
                Circle().fill(tone.color).frame(width: 6, height: 6)
            }
            Text(verbatim: text)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(tone.color)
                .lineLimit(1)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Map canvas (web WidgetMapView + Circle/Marker)

/// The MapKit canvas — the native parity of the web `WidgetMapView` with a
/// `Circle` per fence (inside = success, else muted) and a vehicle `Marker`. Owns
/// the camera so it frames the vehicle plus every fence.
struct GeofenceWidgetMapCanvas: View {
    let projection: GeofenceWidgetProjection

    @State private var camera: MapCameraPosition

    init(projection: GeofenceWidgetProjection) {
        self.projection = projection
        _camera = State(initialValue: TSMapCamera.fitting(projection.mapCoordinates))
    }

    /// Only fences with a geographically valid center get a circle overlay.
    private var drawableFences: [GeofenceWidgetFenceStatus] {
        projection.fences.filter { TSGeo.isValid($0.coordinate) }
    }

    var body: some View {
        Map(position: $camera, interactionModes: .all) {
            ForEach(drawableFences) { fence in
                MapCircle(center: fence.coordinate, radius: max(fence.radiusMeters, 1))
                    .foregroundStyle(circleColor(fence).opacity(0.15))
                    .stroke(circleColor(fence), lineWidth: 2)
            }
            if let vehicle = projection.vehicleCoordinate {
                Annotation(
                    GeofenceWidgetStrings.string("widget.geofence.markerA11y", "Vehicle"),
                    coordinate: vehicle,
                    anchor: .center
                ) {
                    TSAnimatedMarker(tone: .accent)
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .onChange(of: projection) { _, newValue in
            camera = TSMapCamera.fitting(newValue.mapCoordinates)
        }
    }

    /// Web `f.inside ? '#22c55e' : '#6b7280'` mapped to theme tokens.
    private func circleColor(_ fence: GeofenceWidgetFenceStatus) -> Color {
        fence.inside ? Color.TS.statusSuccess : Color.TS.textMuted
    }
}
