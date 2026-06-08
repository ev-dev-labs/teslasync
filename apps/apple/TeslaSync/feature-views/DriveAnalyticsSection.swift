//
//  DriveAnalyticsSection.swift
//  TeslaSync — P4 feature view · 0166 · DriveAnalyticsSection (Apple)
//
//  The composable driving-dynamics "Drive Analytics" surface — the SwiftUI parity of
//  features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx. Renders the header + date
//  range picker (always visible, web `<FadeIn delay={0.45}>`), then switches over the bound model's
//  phase so every prompt-required state renders (loading / empty / error / stale / offline / content)
//  — never a blank box. The content is the three Swift Charts panels the web composes: Speed
//  Distribution (bar), Acceleration Patterns (scatter), and Power Profile (dual area). Binds through
//  `DriveAnalyticsSectionModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable "Drive Analytics" section — the SwiftUI parity of the web `DriveAnalyticsSection`,
/// binding through `DriveAnalyticsSectionModel` (P1/S8).
public struct DriveAnalyticsSection: View {
    @State private var model: DriveAnalyticsSectionModel

    public init(model: DriveAnalyticsSectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSFadeIn(delay: 0.05) {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    DriveAnalyticsSectionHeader(connection: model.connection)
                    if model.connection != .live {
                        DriveAnalyticsSectionConnectivityBanner(connection: model.connection)
                    }
                    DriveAnalyticsSectionRangeFilter(start: startBinding, end: endBinding)
                }
            }
            TSFadeIn(delay: 0.1) {
                content
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The phase-switched body so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            DriveAnalyticsSectionLoading()
        case let .error(message):
            DriveAnalyticsSectionErrorView(message: message) { model.refresh() }
        case .empty:
            DriveAnalyticsSectionEmpty()
        case .content:
            loadedContent
        }
    }

    /// The resolved section body: the speed-distribution + acceleration scatter pair (web 2-up `Grid`)
    /// and the full-width power profile — each chart carrying its own inner empty state (web parity).
    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 320), spacing: TSSpacing.lg)],
                alignment: .leading,
                spacing: TSSpacing.lg
            ) {
                DriveAnalyticsSectionSpeedChart(
                    buckets: model.projection.speedDistribution,
                    accessibilitySummary: speedAccessibility
                )
                DriveAnalyticsSectionAccelChart(
                    points: model.projection.accelPatterns,
                    average: model.projection.accelAverage,
                    distanceUnit: model.projection.distanceUnit,
                    accessibilitySummary: accelAccessibility
                )
            }
            DriveAnalyticsSectionPowerChart(
                points: model.projection.powerProfile,
                accessibilitySummary: powerAccessibility
            )
        }
    }

    // MARK: Range-picker bindings (web `onStartDateChange` / `onEndDateChange`)

    private var startBinding: Binding<Date> {
        Binding(
            get: { model.rangeStart },
            set: { model.setRange(start: $0, end: model.rangeEnd) }
        )
    }

    private var endBinding: Binding<Date> {
        Binding(
            get: { model.rangeEnd },
            set: { model.setRange(start: model.rangeStart, end: $0) }
        )
    }

    // MARK: Per-chart VoiceOver summaries

    private var speedAccessibility: String {
        DriveAnalyticsSectionAccessibility.speedSummary(
            for: model.projection,
            localize: DriveAnalyticsSectionStrings.string
        )
    }

    private var accelAccessibility: String {
        DriveAnalyticsSectionAccessibility.accelSummary(
            for: model.projection,
            localize: DriveAnalyticsSectionStrings.string
        )
    }

    private var powerAccessibility: String {
        DriveAnalyticsSectionAccessibility.powerSummary(
            for: model.projection,
            localize: DriveAnalyticsSectionStrings.string
        )
    }
}
