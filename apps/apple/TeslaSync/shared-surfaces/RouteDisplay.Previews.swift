//
//  RouteDisplay.Previews.swift
//  TeslaSync — P4 shared surface · 0101 · RouteDisplay (Apple)
//
//  Xcode previews for every branch the web source renders, each as a history-style row on the glass
//  surface: from → to, round trip (matching addresses), round trip (coordinates within threshold),
//  single location (a charger, no end), per-endpoint fallback (one side missing), coordinate
//  fallback (no address), no-location, and the no-icon variant. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A faux history row hosting the line, so each branch reads on the real glass surface.
    private struct RouteDisplayPreviewRow: View {
        let title: String
        let route: RouteDisplay

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                route
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
        }
    }

    private struct RouteDisplayPreviewGallery: View {
        var body: some View {
            ScrollView {
                VStack(spacing: TSSpacing.md) {
                    RouteDisplayPreviewRow(
                        title: "From → To",
                        route: RouteDisplay(
                            start: RouteDisplayEndpoint(address: "Home"),
                            end: RouteDisplayEndpoint(address: "Office")
                        )
                    )
                    RouteDisplayPreviewRow(
                        title: "Round trip (addresses match)",
                        route: RouteDisplay(
                            start: RouteDisplayEndpoint(address: "Home"),
                            end: RouteDisplayEndpoint(address: "Home")
                        )
                    )
                    RouteDisplayPreviewRow(
                        title: "Round trip (coords within threshold)",
                        route: RouteDisplay(
                            start: RouteDisplayEndpoint(lat: 47.71, lon: -122.18),
                            end: RouteDisplayEndpoint(lat: 47.71, lon: -122.18)
                        )
                    )
                    RouteDisplayPreviewRow(
                        title: "Single location (charger, no end)",
                        route: RouteDisplay(start: RouteDisplayEndpoint(address: "Supercharger Costco"))
                    )
                    RouteDisplayPreviewRow(
                        title: "Per-endpoint fallback (one side missing)",
                        route: RouteDisplay(
                            start: RouteDisplayEndpoint(address: "Home"),
                            end: RouteDisplayEndpoint()
                        )
                    )
                    RouteDisplayPreviewRow(
                        title: "Coordinate fallback (no address)",
                        route: RouteDisplay(
                            start: RouteDisplayEndpoint(lat: 47.71, lon: -122.18),
                            end: RouteDisplayEndpoint(lat: 47.80, lon: -122.18)
                        )
                    )
                    RouteDisplayPreviewRow(
                        title: "No location data",
                        route: RouteDisplay(
                            start: RouteDisplayEndpoint(),
                            end: RouteDisplayEndpoint()
                        )
                    )
                    RouteDisplayPreviewRow(
                        title: "No icon",
                        route: RouteDisplay(
                            start: RouteDisplayEndpoint(address: "Home"),
                            end: RouteDisplayEndpoint(address: "Office"),
                            showIcon: false
                        )
                    )
                }
                .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("RouteDisplay — branches (light)") {
        RouteDisplayPreviewGallery()
            .preferredColorScheme(.light)
    }

    #Preview("RouteDisplay — branches (dark)") {
        RouteDisplayPreviewGallery()
            .preferredColorScheme(.dark)
    }
#endif
