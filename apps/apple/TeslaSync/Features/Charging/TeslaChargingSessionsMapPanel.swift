//
//  TeslaChargingSessionsMapPanel.swift
//  TeslaSync — P4 feature view · P7 · charging/TeslaChargingSessions (Apple) — Session Locations
//
//  GlassPanel 9 — the "Session Locations" panel (web Leaflet map). A first-party
//  MapKit `Map` (never a WKWebView) that plots every charging session with a known
//  coordinate (web `mapPoints`), frames the camera to fit them, shows a plotted-
//  count chip, and opens a callout (web popup) on tap with the site, start time,
//  energy and cost. When no session has a coordinate the panel shows the
//  `noMapData` empty state — never a blank region. Tokens for all color/typography;
//  energy is converted from SI Wh at the boundary.
//

import CoreLocation
import MapKit
import SwiftUI

// MARK: - Map marker projection (web mapPoints[i])

/// One plotted charging-site marker derived from a session with a coordinate.
struct ChargingSessionMapMarker: Identifiable, Equatable {
    let id: Int64
    let latitude: Double
    let longitude: Double
    let siteName: String
    let startISO: String?
    let energyWh: Double
    let cost: Double?
    let currencyCode: String

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    /// Build a marker from a plottable session (web `mapPoints` filter already
    /// applied by the model), carrying the popup display fields.
    static func from(_ session: TeslaFleetChargingSession, currencyCode: String) -> ChargingSessionMapMarker? {
        guard let latitude = session.latitude, let longitude = session.longitude,
              latitude.isFinite, longitude.isFinite
        else { return nil }
        return ChargingSessionMapMarker(
            id: session.sessionID,
            latitude: latitude,
            longitude: longitude,
            siteName: session.siteLocationName,
            startISO: session.chargeStartDatetime,
            energyWh: session.totalEnergyAddedWh,
            cost: session.totalCost,
            currencyCode: currencyCode
        )
    }
}

// MARK: - Region maths (web `center` memo + fit-to-bounds)

/// Pure camera-region helpers for the session map.
enum ChargingSessionsMapRegion {
    /// The web default center when there is nothing to plot (`37.77, -122.42`).
    static let defaultCenter = CLLocationCoordinate2D(latitude: 37.77, longitude: -122.42)

    /// A region that frames every marker with padding, or a continental fallback
    /// centered on the web default when the set is empty.
    static func region(for markers: [ChargingSessionMapMarker]) -> MKCoordinateRegion {
        guard let first = markers.first else {
            return MKCoordinateRegion(
                center: defaultCenter,
                span: MKCoordinateSpan(latitudeDelta: 30, longitudeDelta: 30)
            )
        }
        var minLat = first.latitude, maxLat = first.latitude
        var minLon = first.longitude, maxLon = first.longitude
        for marker in markers.dropFirst() {
            minLat = min(minLat, marker.latitude)
            maxLat = max(maxLat, marker.latitude)
            minLon = min(minLon, marker.longitude)
            maxLon = max(maxLon, marker.longitude)
        }
        let center = CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2,
            longitude: (minLon + maxLon) / 2
        )
        let span = MKCoordinateSpan(
            latitudeDelta: max((maxLat - minLat) * 1.4, 0.05),
            longitudeDelta: max((maxLon - minLon) * 1.4, 0.05)
        )
        return MKCoordinateRegion(center: center, span: span)
    }
}

// MARK: - GlassPanel 9 — Session Locations

/// The session-locations panel (web GlassPanel 9). Header + interactive map of the
/// plotted sessions, or the `noMapData` empty state.
struct ChargingSessionsMapPanel: View {
    let sessions: [TeslaFleetChargingSession]
    let userCurrency: String
    let isLoading: Bool

    private var markers: [ChargingSessionMapMarker] {
        sessions.compactMap { ChargingSessionMapMarker.from($0, currencyCode: $0.currencyCode ?? userCurrency) }
    }

    var body: some View {
        ChargingSessionsCard {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                ChargingSessionsSectionHeader(
                    systemImage: "mappin.and.ellipse",
                    title: String(localized: "translation.tesla_sessions.map", defaultValue: "Session Locations")
                )

                if isLoading {
                    mapSkeleton
                } else if markers.isEmpty {
                    emptyState
                } else {
                    ChargingSessionsMapCanvas(markers: markers)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label(
                String(
                    localized: "translation.tesla_sessions.noMapData",
                    defaultValue: "No location data available yet."
                ),
                systemImage: "mappin.slash"
            )
        }
        .frame(height: 350)
        .frame(maxWidth: .infinity)
    }

    private var mapSkeleton: some View {
        RoundedRectangle(cornerRadius: TSRadius.lg)
            .fill(Color.TS.surface)
            .frame(height: 350)
            .redacted(reason: .placeholder) // parity:allow native shimmer for the map loading state
    }
}

// MARK: - Map canvas (web MapContainer + markers + popup)

/// The MapKit canvas. Frames the camera on the plotted markers, refits when they
/// change, shows a plotted-count chip, and raises a callout on marker tap.
struct ChargingSessionsMapCanvas: View {
    let markers: [ChargingSessionMapMarker]

    @State private var camera: MapCameraPosition
    @State private var selectedID: Int64?

    init(markers: [ChargingSessionMapMarker]) {
        self.markers = markers
        _camera = State(initialValue: .region(ChargingSessionsMapRegion.region(for: markers)))
    }

    var body: some View {
        Map(position: $camera) {
            ForEach(markers) { marker in
                Annotation(marker.siteName, coordinate: marker.coordinate, anchor: .bottom) {
                    Button {
                        selectedID = marker.id
                    } label: {
                        ChargingSessionsMapPin(selected: marker.id == selectedID)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: accessibilityLabel(marker)))
                    .accessibilityAddTraits(.isButton)
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .frame(minHeight: 350)
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .overlay(alignment: .topLeading) {
            if let selected {
                ChargingSessionsMapCallout(marker: selected) { selectedID = nil }
                    .padding(TSSpacing.md)
            }
        }
        .overlay(alignment: .bottomLeading) {
            ChargingSessionsMapCountChip(count: markers.count)
                .padding(TSSpacing.md)
        }
        .onChange(of: markers) { _, newMarkers in
            camera = .region(ChargingSessionsMapRegion.region(for: newMarkers))
            if let selectedID, !newMarkers.contains(where: { $0.id == selectedID }) {
                self.selectedID = nil
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(String(
            localized: "translation.tesla_sessions.map",
            defaultValue: "Session Locations"
        )))
    }

    private var selected: ChargingSessionMapMarker? {
        guard let selectedID else { return nil }
        return markers.first { $0.id == selectedID }
    }

    private func accessibilityLabel(_ marker: ChargingSessionMapMarker) -> String {
        let energy = ChargingSessionsFormat.energyKWh(marker.energyWh, precision: 1)
        return "\(marker.siteName), \(energy)"
    }
}

// MARK: - Marker pin (web cluster marker, #22d3ee)

/// A charging-site pin — a bolt glyph in the brand-accent disc; the selected pin
/// is enlarged with a ring.
struct ChargingSessionsMapPin: View {
    let selected: Bool

    var body: some View {
        Image(systemName: "bolt.fill")
            .font(.system(size: selected ? 15 : 12, weight: .bold))
            .foregroundStyle(.white)
            .padding(selected ? 9 : 7)
            .background(Color.TS.accent, in: Circle())
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .overlay {
                if selected {
                    Circle().strokeBorder(Color.TS.accent.opacity(0.5), lineWidth: 3).padding(-3)
                }
            }
            .shadow(radius: 2)
    }
}

// MARK: - Count chip (web MarkerCluster badge)

/// The plotted-session count chip (web cluster count badge).
struct ChargingSessionsMapCountChip: View {
    let count: Int

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: "\(ChargingSessionsFormat.integer(count)) · \(plottedLabel)")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(ChargingSessionsFormat.integer(count)) \(plottedLabel)"))
    }

    private var plottedLabel: String {
        String(localized: "translation.tesla_sessions.map", defaultValue: "Session Locations")
    }
}

// MARK: - Callout (web Leaflet popup)

/// The marker callout card — the native parity of the web Leaflet popup: the site
/// name, the start date-time, and the energy + optional cost rows, with a dismiss
/// control.
struct ChargingSessionsMapCallout: View {
    let marker: ChargingSessionMapMarker
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: marker.siteName)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                Button(action: onDismiss) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(String(localized: "translation.common.dismiss", defaultValue: "Dismiss")))
            }
            calloutRow(
                label: String(localized: "translation.tesla_sessions.col.date", defaultValue: "Date"),
                value: ChargingSessionsFormat.dateTime(marker.startISO)
            )
            calloutRow(
                label: String(localized: "translation.tesla_sessions.col.energy", defaultValue: "Energy (kWh)"),
                value: ChargingSessionsFormat.energyKWh(marker.energyWh, precision: 1)
            )
            if let cost = marker.cost {
                calloutRow(
                    label: String(localized: "translation.tesla_sessions.col.cost_decimal", defaultValue: "Cost"),
                    value: ChargingSessionsFormat.currency(cost, code: marker.currencyCode, fractionDigits: 2)
                )
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 260, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private func calloutRow(label: String, value: String) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.trailing)
        }
    }
}
