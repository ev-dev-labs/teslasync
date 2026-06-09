//
//  LoadingSkeleton.swift
//  TeslaSync — P4 feature view · LoadingSkeleton (Apple)
//
//  The shared, Apple-idiomatic charging `LoadingSkeleton`. One parameterized
//  SwiftUI surface reproduces both web sources that map to this native filename:
//
//    • `charging-curve/LoadingSkeleton.tsx`  → `LoadingSkeleton(layout: .chargingCurve)` (P4·0088)
//    • `cost-analysis/LoadingSkeleton.tsx`   → `LoadingSkeleton(layout: .costAnalysis)`  (P4·0115)
//
//  It walks the chosen ``LoadingSkeletonLayout`` region projection block-for-block
//  (mapped to platform tokens, no Tailwind ported), resolves grid columns from
//  the horizontal size class (web base / lg / xl breakpoints), exposes the whole
//  surface to VoiceOver as one "busy" element (the shimmer blocks are
//  decorative), respects Reduce Motion through `TSSkeleton`, and emits the
//  P1/S11 `view.opened` diagnostics event on appear.
//

import SwiftUI

/// Native, Apple-idiomatic parity of the web charging `LoadingSkeleton` family.
///
/// A pure presentational surface: it owns no data — exactly like the web
/// components — so the empty / error / stale / offline states belong to the
/// parent page that swaps this skeleton out once its query resolves. The surface
/// it draws is selected by ``LoadingSkeletonLayout``; the whole thing is exposed
/// to VoiceOver as a single "busy" element and the shimmer respects Reduce
/// Motion. On appear it emits the P1/S11 `view.opened` diagnostics event with the
/// ``LoadingSkeletonSurface/slug``.
public struct LoadingSkeleton: View {
    private let layout: LoadingSkeletonLayout
    private let telemetry: any LoadingSkeletonTelemetry

    /// - Parameters:
    ///   - layout: the structural projection to render; defaults to the
    ///     charging-curve layout.
    ///   - telemetry: diagnostics sink; defaults to the redaction-safe `os_log`
    ///     sink.
    public init(
        layout: LoadingSkeletonLayout = .chargingCurve,
        telemetry: any LoadingSkeletonTelemetry = OSLogLoadingSkeletonTelemetry()
    ) {
        self.layout = layout
        self.telemetry = telemetry
    }

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        /// Wide layout (web `lg:`/`xl:`) on regular width; the web base grid on
        /// compact width (iPhone portrait).
        private var isRegularWidth: Bool {
            horizontalSizeClass != .compact
        }
    #else
        /// macOS windows are always treated as the wide (regular) bucket.
        private var isRegularWidth: Bool {
            true
        }
    #endif

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xl) {
            ForEach(Array(layout.regions.enumerated()), id: \.offset) { _, region in
                LoadingSkeletonRegionView(region: region, isRegularWidth: isRegularWidth)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityAddTraits(.updatesFrequently)
        .task { LoadingSkeletonSurface.reportOpen(to: telemetry) }
    }

    private var accessibilityLabel: String {
        LoadingSkeletonLSStrings.string(layout.accessibilityLabelKey, layout.accessibilityLabelFallback)
    }
}
