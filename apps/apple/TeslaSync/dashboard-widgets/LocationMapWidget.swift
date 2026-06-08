//
//  LocationMapWidget.swift
//  TeslaSync — P4 dashboard widget · 0060 · LocationMapWidget (Apple)
//
//  The composable Vehicle Location Map dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/LocationMapWidget.tsx. Renders every state from the
//  web source (loading / empty / error / stale / offline / content) inside a glass
//  widget shell, binding through `LocationMapModel` (P1/S8). No networking here.
//
//  Web → native mappings:
//    • WidgetShell        → the glass panel + header (icon/title/freshness/refresh)
//    • WidgetMapView      → MapKit `Map` (web Leaflet `MapContainer`)
//    • AnimatedMarker     → `TSAnimatedMarker` pulse + a heading arrow
//    • status overlay     → bottom-leading chips (last-known / heading / coords)
//

import CoreLocation
import MapKit
import SwiftUI

// MARK: - LocationMapWidget (the dashboard surface)

/// The composable Vehicle Location Map dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/LocationMapWidget.tsx`. Renders every state from
/// the web source inside a glass widget shell, binding through `LocationMapModel`
/// (P1/S8). No networking lives here.
public struct LocationMapWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "LocationMapWidget"

    /// Canonical registry metadata (registry/maps.ts → "location-map").
    public static let registration = DashboardWidgetRegistration(
        id: "location-map",
        nameKey: "widget.locationMap.title",
        descriptionKey: "widget.locationMap.description",
        category: "maps",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: LocationMapModel
    private let size: DashboardWidgetSize

    public init(
        model: LocationMapModel,
        size: DashboardWidgetSize = LocationMapWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = LocationMapWidget.registration.clamp(size)
    }

    /// Web `isCompact = size.cols <= 1` — hides the header chrome.
    private var isCompact: Bool {
        size.cols <= 1
    }

    /// Web `isExpanded = size.cols >= 3 || size.rows >= 3` — promotes the
    /// heading + coordinate overlay chips.
    private var isExpanded: Bool {
        size.cols >= 3 || size.rows >= 3
    }

    public var body: some View {
        VStack(spacing: 0) {
            if !isCompact {
                header
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.top, TSSpacing.md)
                    .padding(.bottom, TSSpacing.sm)
            }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension LocationMapWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "mappin.and.ellipse")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            LocationMapStrings.text("widget.locationMap.title", "Vehicle Location Map")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
        }
    }

    /// Live / stale / offline freshness chip (native chrome, parity of the web
    /// `DataFreshness` indicator the shell renders from the query state).
    private var freshnessChip: some View {
        HStack(spacing: 4) {
            Circle().fill(freshnessTone).frame(width: 6, height: 6)
            Text(verbatim: freshnessLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: freshnessLabel))
    }

    private var freshnessTone: Color {
        switch model.connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var freshnessLabel: String {
        switch model.connection {
        case .live: LocationMapStrings.string("widget.locationMap.live", "Live")
        case .stale: LocationMapStrings.string("widget.locationMap.stale", "Stale")
        case .offline: LocationMapStrings.string("widget.locationMap.offline", "Offline")
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(LocationMapStrings.text("widget.locationMap.refresh", "Refresh"))
    }
}

// MARK: - Content states

extension LocationMapWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            mapContent
        }
    }

    private var loadingChrome: some View {
        ZStack(alignment: .bottomLeading) {
            TSSkeleton(height: 0, cornerRadius: 0)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if !isCompact {
                HStack(spacing: TSSpacing.xs) {
                    TSSkeleton(width: 96, height: 16, cornerRadius: TSRadius.pill)
                    TSSkeleton(width: 64, height: 16, cornerRadius: TSRadius.pill)
                }
                .padding(TSSpacing.sm)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(LocationMapStrings.text("widget.locationMap.loading", "Loading vehicle location"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                LocationMapStrings.text("widget.locationMap.noData", "No location data available")
            } icon: {
                Image(systemName: "mappin.slash")
            }
        } description: {
            LocationMapStrings.text(
                "widget.locationMap.emptyHint",
                "Connect a vehicle to see its position on the map."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.md)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            LocationMapStrings.text("widget.locationMap.errorTitle", "Couldn't load vehicle location")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                LocationMapStrings.text("widget.locationMap.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Map content + overlays

extension LocationMapWidget {
    private var mapContent: some View {
        ZStack(alignment: .bottomLeading) {
            LocationMapCanvas(location: model.location, compact: isCompact)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(
                    LocationMapStrings.text("widget.locationMap.mapA11y", "Map showing the vehicle's current position")
                )
                .accessibilityValue(
                    Text(verbatim: LocationMapAccessibility.summary(
                        location: model.location,
                        connection: model.connection
                    ))
                )

            if !isCompact {
                overlayChips
                    .padding(TSSpacing.sm)
            }
        }
        .overlay(alignment: .topTrailing) {
            if isCompact {
                Circle()
                    .fill(freshnessTone)
                    .frame(width: 7, height: 7)
                    .padding(TSSpacing.sm)
                    .accessibilityHidden(true)
            }
        }
    }

    /// The bottom-leading status overlay (web "Status overlay" block).
    private var overlayChips: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !model.connection.isLive {
                LocationOverlayChip(
                    systemImage: "mappin",
                    text: LocationMapStrings.string("widget.locationMap.lastKnown", "Last known position"),
                    tone: Color.TS.statusWarning
                )
            }
            if isExpanded, let degrees = model.location.headingDegrees {
                let label = LocationMapStrings.string("widget.locationMap.heading", "Heading")
                LocationOverlayChip(
                    systemImage: "location.north.fill",
                    text: "\(label): \(degrees)°",
                    tone: Color.TS.textSecondary
                )
            }
            if isExpanded {
                LocationOverlayChip(
                    systemImage: nil,
                    text: model.location.coordinatesText,
                    tone: Color.TS.textSecondary
                )
            }
        }
    }
}

// MARK: - Map canvas (web WidgetMapView)

/// The MapKit canvas — the native parity of the web `WidgetMapView`
/// (`MapContainer` + dark `MapTileLayer` + `AnimatedMarker`). Owns the camera so
/// the marker stays centered; disables interaction when compact (web sets
/// `scrollWheelZoom`/`dragging`/`zoomControl` to `!compact`).
private struct LocationMapCanvas: View {
    let location: VehicleLocation
    let compact: Bool

    @State private var camera: MapCameraPosition

    init(location: VehicleLocation, compact: Bool) {
        self.location = location
        self.compact = compact
        _camera = State(initialValue: LocationMapCanvas.region(for: location, compact: compact))
    }

    var body: some View {
        Map(position: $camera, interactionModes: compact ? [] : .all) {
            Annotation(
                LocationMapStrings.string("widget.locationMap.markerA11y", "Vehicle"),
                coordinate: location.coordinate,
                anchor: .center
            ) {
                LocationMapMarker(heading: location.heading)
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .onChange(of: location) { _, newValue in
            camera = LocationMapCanvas.region(for: newValue, compact: compact)
        }
    }

    /// The camera region centered on the coordinate. The span mirrors the web
    /// zoom (compact `13` → a wider span, expanded `14` → a tighter one).
    static func region(for location: VehicleLocation, compact: Bool) -> MapCameraPosition {
        let delta = compact ? 0.02 : 0.01
        return .region(
            MKCoordinateRegion(
                center: location.coordinate,
                span: MKCoordinateSpan(latitudeDelta: delta, longitudeDelta: delta)
            )
        )
    }
}

// MARK: - Marker (web AnimatedMarker)

/// The live vehicle marker — the shared `TSAnimatedMarker` pulse (Reduce-Motion
/// aware) with a heading arrow overlaid when a heading is known. Parity of the
/// web `AnimatedMarker` (pulsing circle + heading-rotated inner dot).
private struct LocationMapMarker: View {
    let heading: Double?

    var body: some View {
        ZStack {
            TSAnimatedMarker(tone: .accent)
            if let heading {
                Image(systemName: "location.north.fill")
                    .font(.system(size: 8, weight: .heavy))
                    .foregroundStyle(.white)
                    .rotationEffect(.degrees(heading))
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Overlay chip

/// A small translucent status chip used by the bottom-leading overlay (web
/// `rounded-full bg-[var(--surface-overlay)] … backdrop-blur-sm`).
private struct LocationOverlayChip: View {
    let systemImage: String?
    let text: String
    let tone: Color

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 9, weight: .semibold))
            }
            Text(verbatim: text)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(.ultraThinMaterial, in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}
