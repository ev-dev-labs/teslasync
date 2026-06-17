//
//  GeofencesPageMapPanel.swift
//  TeslaSync — P4 feature view · P7 · maps/Geofences (Apple) — Maps + create/edit form
//
//  The MapKit surfaces (never a WKWebView) and the create/edit sheet they live in.
//  Three native peers of the web Leaflet stack: `GeofencesMapTileLayer` (web
//  `MapTileLayer` — the dark base style), `GeofencesDrawMap` (web `MapContainer` —
//  the interactive `Map`), and `GeofencesGeofenceDrawer` (web `GeofenceDrawer` —
//  tap-to-place a circular fence, drag the radius). They are hosted by
//  `GeofencesUseCurrentLocationPanel` (web GlassPanel 8) inside `GeofencesFormSheet`
//  (web create/edit `Modal`). Tokens for all color/typography; the radius is metres
//  (SI) throughout and only formatted at the boundary.
//

import CoreLocation
import MapKit
import SwiftUI

// MARK: - Map tile layer (web `MapTileLayer style="dark"`)

/// The base map style (web `MapTileLayer` dark tiles). A first-party MapKit style,
/// not a raster tile URL — the native equivalent of the web dark basemap.
enum GeofencesMapTileLayer {
    /// The dark, POI-free base style applied to the draw map.
    static var dark: MapStyle {
        .standard(elevation: .flat, pointsOfInterest: .excludingAll, showsTraffic: false)
    }
}

// MARK: - Draw map (web `MapContainer` + draft circle)

/// The interactive draw map (web `MapContainer`): renders the draft fence as a
/// `MapCircle`, frames the camera on the draft/context fences, and converts a tap
/// into a new fence centre via `MapReader`.
struct GeofencesDrawMap: View {
    let draft: GeofencesDraftFence?
    let contextZones: [GeofenceZone]
    let onDraw: (CLLocationCoordinate2D) -> Void

    @State private var camera: MapCameraPosition

    init(
        draft: GeofencesDraftFence?,
        contextZones: [GeofenceZone],
        onDraw: @escaping (CLLocationCoordinate2D) -> Void
    ) {
        self.draft = draft
        self.contextZones = contextZones
        self.onDraw = onDraw
        _camera = State(initialValue: .region(GeofencesMapGeometry.region(draft: draft, zones: contextZones)))
    }

    var body: some View {
        MapReader { proxy in
            Map(position: $camera) {
                ForEach(contextZones) { zone in
                    MapCircle(center: zone.coordinate, radius: zone.radius)
                        .foregroundStyle(Color.TS.textMuted.opacity(0.10))
                        .stroke(Color.TS.textMuted.opacity(0.35), lineWidth: 1)
                }
                if let draft {
                    MapCircle(center: draft.coordinate, radius: draft.radius)
                        .foregroundStyle(Color.TS.accent.opacity(0.20))
                        .stroke(Color.TS.accent, lineWidth: 2)
                    Annotation(draft.name ?? draftPinLabel, coordinate: draft.coordinate, anchor: .bottom) {
                        Image(systemName: "mappin.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(Color.TS.accent)
                            .background(Circle().fill(.white).padding(3))
                            .accessibilityHidden(true)
                    }
                }
            }
            .mapStyle(GeofencesMapTileLayer.dark)
            .onTapGesture { point in
                if let coordinate = proxy.convert(point, from: .local) {
                    onDraw(coordinate)
                }
            }
        }
        .frame(height: 260)
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onChange(of: draft) { _, newDraft in
            camera = .region(GeofencesMapGeometry.region(draft: newDraft, zones: contextZones))
        }
    }

    private var draftPinLabel: String {
        String(localized: "geofences.drawerLabel", defaultValue: "Geofence drawing map")
    }
}

// MARK: - Geofence drawer (web `GeofenceDrawer` circle mode)

/// The circle-drawing control surface (web `GeofenceDrawer`): the draw hint, the
/// interactive draw map, a live coordinate read-out and a radius slider — tap the
/// map to place the fence, drag the slider to size it. All edits flow back through
/// the callbacks into the form.
struct GeofencesGeofenceDrawer: View {
    let draft: GeofencesDraftFence?
    let radius: Double
    let contextZones: [GeofenceZone]
    let onDraw: (CLLocationCoordinate2D) -> Void
    let onRadiusChange: (Double) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(String(
                localized: "geofences.drawHint",
                defaultValue: "Click the circle tool, then click and drag on the map to draw a fence."
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)

            GeofencesDrawMap(draft: draft, contextZones: contextZones, onDraw: onDraw)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text(String(
                    localized: "geofences.drawerLabel",
                    defaultValue: "Geofence drawing map"
                )))

            radiusControl
            if let draft {
                Text(GeofencesFormat.coordinate(latitude: draft.latitude, longitude: draft.longitude))
                    .font(Font.TS.caption.monospacedDigit())
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
    }

    private var radiusControl: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: "ruler")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Slider(
                value: Binding(get: { radius }, set: { onRadiusChange($0) }),
                in: 10 ... 50000
            )
            .accessibilityLabel(Text(String(localized: "Radius (meters)", defaultValue: "Radius (meters)")))
            .accessibilityValue(Text(GeofencesFormat.radius(radius)))
            Text(GeofencesFormat.radius(radius))
                .font(Font.TS.caption.monospacedDigit())
                .foregroundStyle(Color.TS.textSecondary)
                .frame(minWidth: 64, alignment: .trailing)
        }
    }
}

// MARK: - GlassPanel 8 — "Use Current Location"

/// The "Use Current Location" panel (web GlassPanel 8): a source segmented control
/// (Vehicle / Browser / Draw on map), the vehicle picker + "Get Location" button,
/// or the draw map. Only shown when creating (web `!editingId`).
struct GeofencesUseCurrentLocationPanel: View {
    @Bindable var model: GeofencesPageModel

    var body: some View {
        GeofencesCard(padding: TSSpacing.lg) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                GeofencesSectionHeader(
                    systemImage: "location.fill",
                    title: String(
                        localized: "geofences.useCurrentLocation",
                        defaultValue: "Use Current Location"
                    )
                )

                Picker(selection: $model.locationSource) {
                    ForEach(GeofencesLocationSource.allCases) { source in
                        Text(source.tabLabel).tag(source)
                    }
                } label: {
                    Text(String(
                        localized: "geofences.useCurrentLocation",
                        defaultValue: "Use Current Location"
                    ))
                }
                .pickerStyle(.segmented)
                .labelsHidden()

                switch model.locationSource {
                case .vehicle:
                    vehiclePicker
                    getLocationButton
                case .browser:
                    getLocationButton
                case .map:
                    GeofencesGeofenceDrawer(
                        draft: model.draftFence,
                        radius: Double(GeofencesText.trim(model.form.radius)) ?? 100,
                        contextZones: model.zones,
                        onDraw: { coordinate in
                            model.applyDrawnFence(
                                latitude: coordinate.latitude,
                                longitude: coordinate.longitude,
                                radius: Double(GeofencesText.trim(model.form.radius)) ?? 100
                            )
                        },
                        onRadiusChange: { newRadius in
                            model.form.radius = String(Int(newRadius.rounded()))
                        }
                    )
                }
            }
        }
    }

    private var vehiclePicker: some View {
        Picker(selection: $model.selectedVehicleID) {
            Text(String(localized: "geofences.chooseVehicle", defaultValue: "— Choose vehicle —"))
                .tag(Int64(0))
            ForEach(model.vehicles) { vehicle in
                Text(vehicle.optionLabel).tag(vehicle.id)
            }
        } label: {
            Text(String(localized: "geofences.selectVehicle", defaultValue: "Select Vehicle"))
        }
        .pickerStyle(.menu)
    }

    private var getLocationButton: some View {
        Button {
            Task { await model.getLocation() }
        } label: {
            HStack(spacing: TSSpacing.sm) {
                if model.isLocating {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "location.fill")
                }
                Text(model.isLocating
                    ? String(localized: "geofences.gettingLocation", defaultValue: "Getting location…")
                    : String(localized: "geofences.getLocation", defaultValue: "Get Location"))
            }
        }
        .buttonStyle(.bordered)
        .disabled(model.isLocating || (model.locationSource == .vehicle && model.selectedVehicleID <= 0))
    }
}

// MARK: - Map geometry helpers

/// Pure camera-region helpers for the draw map.
enum GeofencesMapGeometry {
    /// The web default centre when nothing is placed yet (`37.7749, -122.4194`).
    static let defaultCenter = CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194)

    /// A region framing the draft (tight) or the existing fences (web centres on
    /// the first geofence), falling back to the web default.
    static func region(draft: GeofencesDraftFence?, zones: [GeofenceZone]) -> MKCoordinateRegion {
        if let draft {
            let span = max(draft.radius / 40000, 0.01)
            return MKCoordinateRegion(
                center: draft.coordinate,
                span: MKCoordinateSpan(latitudeDelta: span, longitudeDelta: span)
            )
        }
        if let first = zones.first {
            return MKCoordinateRegion(
                center: first.coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.2, longitudeDelta: 0.2)
            )
        }
        return MKCoordinateRegion(
            center: defaultCenter,
            span: MKCoordinateSpan(latitudeDelta: 0.5, longitudeDelta: 0.5)
        )
    }
}

// MARK: - Coordinate bridges

extension GeofenceZone {
    /// The fence centre as a MapKit coordinate.
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

extension GeofencesDraftFence {
    /// The draft centre as a MapKit coordinate.
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
