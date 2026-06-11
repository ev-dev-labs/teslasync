//
//  TripReplayMap.Views.swift
//  TeslaSync — P4 feature view · 0274 · TripReplayMap (Apple)
//
//  The MapKit canvas + its furniture — the native parity of the web Leaflet
//  `MapContainer` and its children: the speed-colored route (web per-pair `Polyline`s),
//  the start / end / stationary-anchor pins (web `CircleMarker`s), the heading-aware
//  playhead that tracks `currentIndex` (web `AnimatedMarker`, with a reduce-motion-safe
//  pulse), and the polyline-tap → nearest-sample → seek channel (web
//  `handlePolylineClick`). The camera frames the plotted route via the shared,
//  unit-tested `TSGeo.boundingRegion`, refitting on route change (web `FitBounds`).
//  Tokens (P1/S9) + facade (P1/S10) + the shared maps primitives only — no Tailwind
//  ports, no raw hex, no networking.
//

import CoreLocation
import MapKit
import SwiftUI

// MARK: - Speed band → semantic token palette (web `speedColor` hex → theme tokens)

/// Maps each speed band to a semantic theme tone instead of the web raw hex, so the
/// trail tracks light/dark and stays HIG-correct: slow → success, moderate → accent,
/// fast → warning, very fast → danger (the toned parity of `#10b981 / #22d3ee /
/// #f59e0b / #ef4444`).
enum TripReplayPalette {
    static func tone(for band: TripReplaySpeedBand) -> TSTone {
        switch band {
        case .slow: .success
        case .moderate: .accent
        case .fast: .warning
        case .veryFast: .danger
        }
    }

    static func color(for band: TripReplaySpeedBand) -> Color {
        tone(for: band).color
    }
}

// MARK: - Map canvas (web MapContainer + MapTileLayer + Polyline + CircleMarkers)

/// The MapKit canvas. Owns its camera so it stays framed on the plotted route,
/// re-fitting whenever the projection changes; a tap resolves to the nearest sample and
/// seeks the page (web polyline `click` → `onSeekToIndex`).
struct TripReplayMapCanvas: View {
    let route: TripReplayRoute
    let positions: [TripReplayPosition]
    let mapStyle: TSMapStyle
    let reduceMotion: Bool
    let localize: (String, String) -> String
    let onSeek: (Int) -> Void

    @State private var camera: MapCameraPosition

    init(
        route: TripReplayRoute,
        positions: [TripReplayPosition],
        mapStyle: TSMapStyle,
        reduceMotion: Bool,
        localize: @escaping (String, String) -> String,
        onSeek: @escaping (Int) -> Void
    ) {
        self.route = route
        self.positions = positions
        self.mapStyle = mapStyle
        self.reduceMotion = reduceMotion
        self.localize = localize
        self.onSeek = onSeek
        _camera = State(initialValue: TSMapCamera.fitting(route.cameraCoordinates.map(\.coordinate)))
    }

    var body: some View {
        MapReader { proxy in
            Map(position: $camera) {
                routeContent
                markerContent
                playheadContent
            }
            .mapStyle(mapStyle.mapStyle)
            .onTapGesture { point in handleTap(point, proxy: proxy) }
            .onChange(of: route) { _, updated in
                camera = TSMapCamera.fitting(updated.cameraCoordinates.map(\.coordinate))
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: TripReplayMapLabels.canvasSummary(for: route, localize: localize)))
        }
    }

    // MARK: Map content

    @MapContentBuilder
    private var routeContent: some MapContent {
        ForEach(route.segments) { segment in
            MapPolyline(coordinates: [segment.start.coordinate, segment.end.coordinate])
                .stroke(
                    TripReplayPalette.color(for: segment.band),
                    style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round)
                )
        }
    }

    @MapContentBuilder
    private var markerContent: some MapContent {
        if let start = route.startPin {
            pin(at: start, tone: .success, title: TripReplayMapLabels.startLabel(localize: localize))
        }
        if let end = route.endPin {
            pin(at: end, tone: .danger, title: TripReplayMapLabels.endLabel(localize: localize))
        }
        if let anchor = route.anchor {
            pin(at: anchor, tone: .accent, title: TripReplayMapLabels.anchorLabel(localize: localize))
        }
    }

    @MapContentBuilder
    private var playheadContent: some MapContent {
        if let playhead = route.playhead {
            Annotation(
                TripReplayMapLabels.playheadLabel(localize: localize),
                coordinate: playhead.coordinate,
                anchor: .center
            ) {
                TripReplayPlayheadMarker(heading: playhead.heading, reduceMotion: reduceMotion)
                    .accessibilityLabel(Text(verbatim: TripReplayMapLabels.playheadLabel(localize: localize)))
            }
        }
    }

    @MapContentBuilder
    private func pin(at coordinate: TripReplayCoordinate, tone: TSTone, title: String) -> some MapContent {
        Annotation(title, coordinate: coordinate.coordinate, anchor: .center) {
            TSCircleMarker(tone: tone)
                .accessibilityLabel(Text(verbatim: title))
        }
    }

    // MARK: Tap → nearest sample → seek (web `handlePolylineClick`)

    /// Resolves a tap to the nearest recorded sample and seeks the page. Only active
    /// when there is a real route (web attaches the `click` handler to the speed
    /// polylines, which exist only when `hasMeaningfulRoute`).
    private func handleTap(_ point: CGPoint, proxy: MapProxy) {
        guard route.hasRoute, !positions.isEmpty else { return }
        guard let coordinate = proxy.convert(point, from: .local) else { return }
        let index = TripReplayGeo.nearestSampleIndex(
            positions,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude
        )
        onSeek(index)
    }
}

// MARK: - Playhead (web `AnimatedMarker` / reduced-motion `CircleMarker`)

/// The heading-aware playhead: a rotated arrow disc that points along the drive's
/// bearing (web `AnimatedMarker` `heading`). Under Reduce Motion the surrounding pulse
/// is suppressed and the arrow snaps — the native parity of the web reduced-motion
/// `CircleMarker` fallback.
struct TripReplayPlayheadMarker: View {
    let heading: Double
    let reduceMotion: Bool

    @State private var pulse = false

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.TS.accent.opacity(0.3))
                .frame(width: 34, height: 34)
                .scaleEffect(pulse && !reduceMotion ? 1.6 : 1)
                .opacity(pulse && !reduceMotion ? 0 : 0.6)
            Image(systemName: "location.north.fill")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .rotationEffect(.degrees(heading))
                .padding(7)
                .background(Color.TS.accent, in: Circle())
                .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                .shadow(radius: 2)
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: heading)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { pulse = true }
        }
    }
}
