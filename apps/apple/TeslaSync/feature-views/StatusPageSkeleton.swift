//
//  StatusPageSkeleton.swift
//  TeslaSync — P4 feature view · StatusPageSkeleton (Apple)
//
//  The shared, Apple-idiomatic System-Status loading skeleton — the native
//  parity of `features/system/components/status/StatusPageSkeleton.tsx`. It walks
//  the ``StatusPageSkeletonLayout`` projection child-for-child (mapped to
//  platform tokens, no Tailwind ported), caps and centres the content at the web
//  `max-w-3xl mx-auto`, exposes the whole surface to VoiceOver as one "busy"
//  element (the shimmer blocks are decorative), respects Reduce Motion through
//  `TSSkeleton`, and emits the P1/S11 `view.opened` diagnostics event on appear.
//

import SwiftUI

/// Native, Apple-idiomatic parity of the web `StatusPageSkeleton`.
///
/// A pure presentational surface: it owns no data — exactly like the web
/// component, which is the layout-shaped loading state the System Status page
/// renders during its initial fetch. The empty / error / stale / offline states
/// therefore belong to the parent page that swaps this skeleton out once its
/// query resolves; this surface *is* the loading state. The whole thing is
/// exposed to VoiceOver as a single "busy" element and the shimmer respects
/// Reduce Motion. On appear it emits the P1/S11 `view.opened` diagnostics event
/// with the ``StatusPageSkeletonSurface/slug``.
public struct StatusPageSkeleton: View {
    private let layout: StatusPageSkeletonLayout
    private let telemetry: any StatusPageSkeletonTelemetry

    /// - Parameters:
    ///   - layout: the structural projection to render; defaults to the single
    ///     web `StatusPageSkeleton` layout.
    ///   - telemetry: diagnostics sink; defaults to the redaction-safe `os_log`
    ///     sink.
    public init(
        layout: StatusPageSkeletonLayout = .standard,
        telemetry: any StatusPageSkeletonTelemetry = OSLogStatusPageSkeletonTelemetry()
    ) {
        self.layout = layout
        self.telemetry = telemetry
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xl) {
            ForEach(Array(layout.regions.enumerated()), id: \.offset) { _, region in
                StatusPageSkeletonRegionView(region: region)
            }
        }
        .frame(maxWidth: layout.maxContentWidth, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityAddTraits(.updatesFrequently)
        .task { StatusPageSkeletonSurface.reportOpen(to: telemetry) }
    }

    private var accessibilityLabel: String {
        StatusPageSkeletonStrings.string(layout.accessibilityLabelKey, layout.accessibilityLabelFallback)
    }
}
