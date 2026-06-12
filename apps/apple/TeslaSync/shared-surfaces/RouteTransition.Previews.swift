//
//  RouteTransition.Previews.swift
//  TeslaSync — P4 shared surface · 0192 · RouteTransition (Apple)
//
//  Xcode previews for the navigation branches the web source supports — a small harness that swaps the
//  route `path` so the live surface plays the cross-fade (a plain page-to-page change) and the instant
//  swap (a list ↔ detail drill the web skips). Reduce Motion is environment-driven (handled in the
//  decision) and toggled through the canvas accessibility overrides. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A self-contained harness that owns the route `path` and offers buttons to navigate, so the live
    /// `RouteTransition` plays its branches on the preview canvas (where there is no real navigator).
    private struct RouteTransitionPreviewHarness: View {
        @State private var path: String
        private let routes: [(label: String, path: String)]

        init(initialPath: String = "/dashboard") {
            _path = State(initialValue: initialPath)
            routes = [
                ("Dashboard", "/dashboard"),
                ("Vehicles", "/vehicles"),
                ("Drives", "/drives"),
                ("Drive 42", "/drives/42")
            ]
        }

        var body: some View {
            VStack(spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.sm) {
                    ForEach(routes, id: \.path) { route in
                        Button {
                            path = route.path
                        } label: {
                            Text(verbatim: route.label)
                                .font(Font.TS.label)
                        }
                        .buttonStyle(.bordered)
                    }
                }

                RouteTransition(path: path) {
                    samplePage(for: path)
                }
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
        }

        private func samplePage(for path: String) -> some View {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: path)
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: "Routed content for this path. Navigating to a sibling page cross-fades; "
                    + "drilling into a detail (e.g. Drive 42) swaps instantly.")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.lg)
            .tsGlassPanel(cornerRadius: TSRadius.lg)
        }
    }

    #Preview("Route transition — navigate") {
        RouteTransitionPreviewHarness(initialPath: "/dashboard")
    }

    #Preview("Route transition — list/detail (instant)") {
        RouteTransitionPreviewHarness(initialPath: "/drives")
    }

    #Preview("Content layer — animated") {
        RouteTransitionContentLayer(
            renderedPath: "/vehicles",
            decision: RouteTransitionDecision(phase: .animated, durationMs: 120),
            content: Text(verbatim: "/vehicles")
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .padding(TSSpacing.lg)
                .tsGlassPanel()
        )
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }
#endif
