//
//  DataPipelineSection.swift
//  TeslaSync — P4 feature view · 0242 · DataPipelineSection (Apple)
//
//  The dev-tools Data Pipeline surface — the SwiftUI parity of
//  features/system/components/status/DataPipelineSection.tsx. The web source is an
//  `AccordionSection` (a collapsible glass panel with an icon, title, description, and
//  a savings / active-jobs badge cluster) wrapping two regions: the Compression
//  Statistics block (four metric cards + a savings radial gauge) and the Export Job
//  Queue block (four status stat-cards + a jobs table, or an empty state). This view
//  reproduces that composition + chrome, binds through `DataPipelineModel` (P1/S8 — no
//  networking here), renders every state, and localizes through `DataPipelineStrings`
//  (P1/S10).
//
//  States (every one renders — no hidden surface):
//    • loading — either query loading → the web two-skeleton chrome.
//    • ready   — the compression block (data or its empty state, the section is
//                never hidden) + the export queue (stat-cards + table, or the web
//                `EmptyState` when the queue is empty).
//    • error   — a query failure → retry affordance (web `QueryError` peer).
//    • stale / offline — the orthogonal `connection` axis → freshness chip + banner
//                with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

/// The dev-tools Data Pipeline feature view. Holds the bound `DataPipelineModel`,
/// renders the collapsible accordion chrome, and drives the compression + export-queue
/// regions through their resolved view-state.
public struct DataPipelineSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "DataPipelineSection"

    @State private var model: DataPipelineModel
    @State private var isExpanded: Bool

    /// Designated initializer — inject a source-backed model (production app) or an
    /// `InMemoryDataPipelineSource`-backed one (previews/tests).
    public init(model: DataPipelineModel, initiallyExpanded: Bool = false) {
        _model = State(initialValue: model)
        _isExpanded = State(initialValue: initiallyExpanded)
    }

    /// Convenience initializer over a bare `DataPipelineSource`.
    public init(
        source: any DataPipelineSource,
        telemetry: any DataPipelineTelemetry = OSLogDataPipelineTelemetry(),
        initiallyExpanded: Bool = false
    ) {
        _model = State(initialValue: DataPipelineModel(source: source, telemetry: telemetry))
        _isExpanded = State(initialValue: initiallyExpanded)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: 0) {
                header
                if isExpanded {
                    TSFadeIn {
                        VStack(alignment: .leading, spacing: TSSpacing.lg) {
                            Divider().overlay(Color.TS.border)
                            toolbar
                            if model.connection != .live {
                                DataPipelineConnectivityBanner(connection: model.connection)
                            }
                            content
                        }
                        .padding(.top, TSSpacing.md)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    // MARK: Accordion header (web `AccordionSection` header row)

    private var header: some View {
        Button {
            withAnimation(.easeInOut(duration: TSMotion.fastDuration)) { isExpanded.toggle() }
        } label: {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "archivebox")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: DataPipelineStrings.string("Data Pipeline", "Data Pipeline"))
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: DataPipelineStrings.string(
                        "pipeline.description",
                        "Compression statistics and export job queue"
                    ))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                }
                Spacer(minLength: TSSpacing.sm)
                DataPipelineHeaderBadges(resolved: model.resolved)
                Image(systemName: "chevron.down")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .rotationEffect(.degrees(isExpanded ? 180 : 0))
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: headerAccessibilityLabel))
        .accessibilityValue(Text(verbatim: isExpanded
                ? DataPipelineStrings.string("a11y.expanded", "Expanded")
                : DataPipelineStrings.string("a11y.collapsed", "Collapsed")))
        .accessibilityHint(Text(verbatim: DataPipelineStrings.string(
            "a11y.toggleHint",
            "Double tap to show or hide the data pipeline details"
        )))
        .accessibilityAddTraits(.isButton)
    }

    private var headerAccessibilityLabel: String {
        DataPipelineStrings.string("Data Pipeline", "Data Pipeline")
            + ", "
            + DataPipelineStrings.string("pipeline.description", "Compression statistics and export job queue")
    }

    // MARK: Freshness toolbar (native P4 leaf chrome)

    private var toolbar: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            DataPipelineFreshnessChip(connection: model.connection)
            refreshButton
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 12, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: DataPipelineStrings.string("pipeline.refresh", "Refresh")))
        .accessibilityHint(Text(verbatim: DataPipelineStrings.string(
            "pipeline.refreshHint",
            "Reloads compression stats and the export job queue"
        )))
    }

    // MARK: Content states (web shell + the P4 leaf contract)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            DataPipelineLoadingView()
        case let .error(message):
            DataPipelineErrorView(message: message) { model.refresh() }
        case .ready:
            DataPipelineReadyContent(resolved: model.resolved)
        }
    }
}
