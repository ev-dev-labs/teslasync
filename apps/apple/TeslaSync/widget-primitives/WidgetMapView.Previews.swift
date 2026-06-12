//
//  WidgetMapView.Previews.swift
//  TeslaSync — P4 widget primitive · 0008 · WidgetMapView (Apple)
//
//  Xcode previews for every real branch of the map primitive: the populated interactive map (with an
//  overlay slot — a marker + a short route), the `compact` non-interactive preview (no controls, no
//  gestures), the childless centered map, the high-latitude span clamp, and the empty leaf. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import CoreLocation
import MapKit
import SwiftUI

#if DEBUG
    @MainActor
    private func stagedMap(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
                .frame(height: 220)
                .padding(TSSpacing.md)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md))
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.bg)
    }

    private let sanFrancisco = CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194)
    private let tromso = CLLocationCoordinate2D(latitude: 69.6492, longitude: 18.9553)
    private let sampleRoute = [
        CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
        CLLocationCoordinate2D(latitude: 37.7790, longitude: -122.4310),
        CLLocationCoordinate2D(latitude: 37.7840, longitude: -122.4090)
    ]

    #Preview("Populated — interactive + overlays") {
        stagedMap("center · zoom 13 · marker + route · interactive (controls shown)") {
            WidgetMapView(center: sanFrancisco, zoom: 13) {
                Marker("Vehicle", systemImage: "car.fill", coordinate: sanFrancisco)
                    .tint(Color.TS.accent)
                MapPolyline(coordinates: sampleRoute)
                    .stroke(Color.TS.accent, lineWidth: 4)
            }
        }
    }

    #Preview("Compact — non-interactive preview") {
        stagedMap("compact · no gestures · no controls · zoom 14") {
            WidgetMapView(center: sanFrancisco, zoom: 14, compact: true) {
                Marker("Vehicle", systemImage: "car.fill", coordinate: sanFrancisco)
                    .tint(Color.TS.accent)
            }
        }
    }

    #Preview("Childless — centered map") {
        stagedMap("no children · centered map · zoom 12") {
            WidgetMapView(center: sanFrancisco, zoom: 12)
        }
    }

    #Preview("High latitude — span clamp") {
        stagedMap("lat 69.6 · cos(lat) narrows the span · zoom 11") {
            WidgetMapView(center: tromso, zoom: 11) {
                Marker("North", systemImage: "mappin", coordinate: tromso)
            }
        }
    }

    #Preview("Empty — no location data") {
        stagedMap("isEmpty · friendly empty leaf · never a bare box") {
            WidgetMapView(center: sanFrancisco, isEmpty: true)
        }
    }
#endif
