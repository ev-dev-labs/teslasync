//
//  LoadingSkeleton.Previews.swift
//  TeslaSync — P4 feature view · LoadingSkeleton (Apple)
//
//  Xcode previews for the LoadingSkeleton surface across both layouts
//  (charging-curve + cost-analysis) and the appearances the Apple HIG requires:
//  light + dark and large Dynamic Type. Reduce Motion is a read-only,
//  system-driven environment value (it cannot be forced from a preview), so the
//  shimmer's Reduce-Motion opt-out is exercised by `TSSkeleton` at runtime and
//  asserted there rather than via a preview override. DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope. Previews use a
//  no-op telemetry sink so rendering them never emits diagnostics.
//

import SwiftUI

#if DEBUG
    /// A telemetry sink that drops events — previews must not emit diagnostics.
    private struct NoopLoadingSkeletonTelemetry: LoadingSkeletonTelemetry {
        func viewOpened(surface _: String) {}
    }

    private struct LoadingSkeletonPreviewHost: View {
        let layout: LoadingSkeletonLayout

        var body: some View {
            ScrollView {
                LoadingSkeleton(layout: layout, telemetry: NoopLoadingSkeletonTelemetry())
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Cost Analysis · Dark") {
        LoadingSkeletonPreviewHost(layout: .costAnalysis)
            .preferredColorScheme(.dark)
    }

    #Preview("Cost Analysis · Light") {
        LoadingSkeletonPreviewHost(layout: .costAnalysis)
            .preferredColorScheme(.light)
    }

    #Preview("Cost Analysis · Dynamic Type accessibility3") {
        LoadingSkeletonPreviewHost(layout: .costAnalysis)
            .environment(\.dynamicTypeSize, .accessibility3)
            .preferredColorScheme(.dark)
    }

    #Preview("Charging Curve · Dark") {
        LoadingSkeletonPreviewHost(layout: .chargingCurve)
            .preferredColorScheme(.dark)
    }
#endif
