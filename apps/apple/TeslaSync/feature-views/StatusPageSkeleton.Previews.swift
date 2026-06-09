//
//  StatusPageSkeleton.Previews.swift
//  TeslaSync — P4 feature view · StatusPageSkeleton (Apple)
//
//  Xcode previews for the StatusPageSkeleton surface across the appearances the
//  Apple HIG requires: light + dark and large Dynamic Type. Reduce Motion is a
//  read-only, system-driven environment value (it cannot be forced from a
//  preview), so the shimmer's Reduce-Motion opt-out is exercised by `TSSkeleton`
//  at runtime rather than via a preview override. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope. Previews use a no-op
//  telemetry sink so rendering them never emits diagnostics.
//

import SwiftUI

#if DEBUG
    /// A telemetry sink that drops events — previews must not emit diagnostics.
    private struct NoopStatusPageSkeletonTelemetry: StatusPageSkeletonTelemetry {
        func viewOpened(surface _: String) {}
    }

    private struct StatusPageSkeletonPreviewHost: View {
        var body: some View {
            ScrollView {
                StatusPageSkeleton(telemetry: NoopStatusPageSkeletonTelemetry())
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("System Status · Dark") {
        StatusPageSkeletonPreviewHost()
            .preferredColorScheme(.dark)
    }

    #Preview("System Status · Light") {
        StatusPageSkeletonPreviewHost()
            .preferredColorScheme(.light)
    }

    #Preview("System Status · Dynamic Type accessibility3") {
        StatusPageSkeletonPreviewHost()
            .environment(\.dynamicTypeSize, .accessibility3)
            .preferredColorScheme(.dark)
    }
#endif
