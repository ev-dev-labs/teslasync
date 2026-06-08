//
//  LoadingSkeleton.swift
//  TeslaSync — P4 feature view · 0088 · LoadingSkeleton (Apple)
//
//  Native, Apple-idiomatic parity of the web charging-curve LoadingSkeleton
//  (features/charging/components/charging-curve/LoadingSkeleton.tsx). The main
//  SwiftUI surface: it composes the seven web regions from the
//  ``LoadingSkeletonLayout`` projection, resolves grid columns from the
//  horizontal size class (web base / lg / xl breakpoints), exposes the whole
//  surface to VoiceOver as one "busy" element, and emits the P1/S11
//  `view.opened` diagnostics event on appear.
//

import SwiftUI

/// Native, Apple-idiomatic parity of the web charging-curve `LoadingSkeleton`
/// (`features/charging/components/charging-curve/LoadingSkeleton.tsx`).
///
/// A pure presentational surface: it owns no data — exactly like the web
/// component — so the empty / error / stale / offline states belong to the
/// parent charging-curve surface that swaps this skeleton out once its query
/// resolves. It reproduces the web source's seven stacked regions block-for-block
/// via the ``LoadingSkeletonLayout`` projection, mapped to platform tokens (no
/// Tailwind ported). The whole surface is exposed to VoiceOver as a single
/// "busy" element (the individual shimmer blocks are decorative) and the shimmer
/// respects Reduce Motion through `TSSkeleton`. On appear it emits the P1/S11
/// `view.opened` diagnostics event with the ``LoadingSkeletonSurface/slug``.
public struct LoadingSkeleton: View {
    private let layout: LoadingSkeletonLayout
    private let telemetry: any LoadingSkeletonTelemetry

    /// - Parameters:
    ///   - layout: the structural projection to render; defaults to the
    ///     charging-curve layout extracted from the web source.
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
            header
            filters
            summaryGrid
            LoadingSkeletonChartPanelView(panel: layout.primaryChart)
            LoadingSkeletonChartPanelView(panel: layout.secondaryChart)
            comparisonGrid
            footerGrid
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityAddTraits(.updatesFrequently)
        .task { LoadingSkeletonSurface.reportOpen(to: telemetry) }
    }

    private var accessibilityLabel: String {
        LoadingSkeletonLSStrings.string(
            LoadingSkeletonStringsKey.accessibilityLabel,
            LoadingSkeletonStringsKey.accessibilityLabelFallback
        )
    }

    // MARK: Regions

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            SkeletonBlockView(block: layout.headerTitle)
            SkeletonBlockView(block: layout.headerSubtitle)
        }
    }

    private var filters: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(Array(layout.filters.indices), id: \.self) { index in
                SkeletonBlockView(block: layout.filters[index])
            }
            Spacer(minLength: 0)
        }
    }

    private var summaryGrid: some View {
        LoadingSkeletonGrid(
            count: layout.summaryStats.count,
            columns: layout.summaryColumns.count(isRegularWidth: isRegularWidth),
            spacing: TSSpacing.lg
        ) { index in
            LoadingSkeletonStatCellView(cell: layout.summaryStats[index])
        }
    }

    private var comparisonGrid: some View {
        LoadingSkeletonGrid(
            count: layout.comparisonCharts.count,
            columns: layout.comparisonColumns.count(isRegularWidth: isRegularWidth),
            spacing: TSSpacing.xl
        ) { index in
            LoadingSkeletonChartPanelView(panel: layout.comparisonCharts[index])
        }
    }

    private var footerGrid: some View {
        LoadingSkeletonGrid(
            count: layout.footerStats.count,
            columns: layout.footerColumns.count(isRegularWidth: isRegularWidth),
            spacing: TSSpacing.lg
        ) { index in
            LoadingSkeletonStatCellView(cell: layout.footerStats[index])
        }
    }
}
