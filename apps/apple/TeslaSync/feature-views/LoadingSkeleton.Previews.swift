//
//  LoadingSkeleton.Previews.swift
//  TeslaSync — P4 feature view · 0088 · LoadingSkeleton (Apple)
//
//  Xcode previews for the LoadingSkeleton surface across the appearances the
//  Apple HIG requires: light + dark and large Dynamic Type. Reduce Motion is a
//  read-only, system-driven environment value (it cannot be forced from a
//  preview), so the shimmer's Reduce-Motion opt-out is exercised by `TSSkeleton`
//  at runtime and asserted there rather than via a preview override. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//  Previews use a no-op telemetry sink so rendering them never emits diagnostics.
//

import SwiftUI

#if DEBUG
    /// A telemetry sink that drops events — previews must not emit diagnostics.
    private struct NoopLoadingSkeletonTelemetry: LoadingSkeletonTelemetry {
        func viewOpened(surface _: String) {}
    }

    private struct LoadingSkeletonPreviewHost: View {
        var body: some View {
            ScrollView {
                LoadingSkeleton(telemetry: NoopLoadingSkeletonTelemetry())
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Dark") {
        LoadingSkeletonPreviewHost()
            .preferredColorScheme(.dark)
    }

    #Preview("Light") {
        LoadingSkeletonPreviewHost()
            .preferredColorScheme(.light)
    }

    #Preview("Dynamic Type · accessibility3") {
        LoadingSkeletonPreviewHost()
            .environment(\.dynamicTypeSize, .accessibility3)
            .preferredColorScheme(.dark)
    }
#endif
