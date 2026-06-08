//
//  SavingsCalculator.swift
//  TeslaSync — P4 feature view · 0118 · SavingsCalculator (Apple)
//
//  The composable "Gas vs Electric Savings Calculator" feature view — the SwiftUI
//  parity of
//  web/src/features/charging/components/cost-analysis/SavingsCalculator.tsx. Binds
//  through `SavingsCalculatorModel` (P1/S8): the model owns the three interactive
//  assumption fields (web input state) and observes the charging aggregates feed,
//  and the comparison is recomputed live as the user edits — the parent hook's
//  `useMemo` behavior. The surface is always mounted so the loading + empty states
//  render in-place rather than gating it. Renders every state (loading / empty /
//  error / stale / offline / content); the assumptions column is present in all of
//  them so the surface is never blank. No networking lives in the view. Emits the
//  P1/S11 `view.opened` diagnostics event with the surface slug `SavingsCalculator`
//  on appear.
//

import SwiftUI

// MARK: - SavingsCalculator (the feature surface)

/// Native, Apple-idiomatic parity of the web `SavingsCalculator`: the "Your
/// Assumptions" input column (gas price / MPG / electricity rate + Reset Defaults)
/// beside the "Comparison" column (the four gas-vs-electric cards, or the "Not
/// enough data" empty message), plus the loading / error / stale / offline chrome
/// the surface contract requires.
public struct SavingsCalculator: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public nonisolated static let surfaceSlug = "SavingsCalculator"

    /// The `view.opened` diagnostics event this surface emits on appear.
    public nonisolated static var viewOpenedEvent: DashboardWidgetTelemetryEvent {
        .viewOpened(surface: surfaceSlug)
    }

    @Bindable private var model: SavingsCalculatorModel
    private let telemetry: (any DashboardWidgetTelemetrySink)?

    /// Live / preview binding: the production app injects a source-backed model.
    public init(model: SavingsCalculatorModel, telemetry: (any DashboardWidgetTelemetrySink)? = nil) {
        self.model = model
        self.telemetry = telemetry
    }

    /// Web-prop binding: the source component renders from the page aggregates +
    /// the assumption inputs. Constructs the bound model so the call site matches
    /// the web `<SavingsCalculator gasComparison={…} gasPrice={…} … />`.
    @MainActor
    public init(
        data: SavingsCalculatorData,
        assumptions: SavingsCalculatorAssumptions = .defaults,
        loading: Bool = false,
        telemetry: (any DashboardWidgetTelemetrySink)? = nil
    ) {
        self.init(
            model: SavingsCalculatorModel(data: data, assumptions: assumptions, loading: loading),
            telemetry: telemetry
        )
    }

    public var body: some View {
        let presentation = SavingsCalculatorPresentation.resolve(state: model.state, assumptions: model.assumptions)
        return TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header(for: presentation)
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: TSSpacing.xl) {
                        assumptionsForm.frame(width: 240, alignment: .topLeading)
                        comparisonRegion(for: presentation).frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                    VStack(alignment: .leading, spacing: TSSpacing.xl) {
                        assumptionsForm
                        comparisonRegion(for: presentation)
                    }
                }
            }
        }
        .task {
            telemetry?.record(SavingsCalculator.viewOpenedEvent)
            model.start()
        }
        .onDisappear { model.stop() }
        .onChange(of: isStale(presentation)) { _, stale in
            if stale { model.refresh() }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Composition

private extension SavingsCalculator {
    /// The "Your Assumptions" input column, bound to the model's field state.
    var assumptionsForm: some View {
        SavingsAssumptionsForm(
            gasPriceText: $model.gasPriceText,
            mpgText: $model.mpgText,
            electricityRateText: $model.electricityRateText,
            onReset: { model.resetDefaults() }
        )
    }

    /// The title row: the calculator glyph, the surface title, and the freshness /
    /// refresh accessory (web `<h3>` header).
    func header(for presentation: SavingsCalculatorPresentation) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "function")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            SavingsCalculatorStrings
                .text("costAnalysis.calculator.title", "Gas vs Electric Savings Calculator")
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            accessory(for: presentation)
        }
    }

    /// The "Comparison" column header + the state-driven region beneath it.
    func comparisonRegion(for presentation: SavingsCalculatorPresentation) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            SavingsCalculatorStrings.text("costAnalysis.calculator.comparison", "Comparison")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(1)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            content(for: presentation)
        }
    }

    @ViewBuilder
    func content(for presentation: SavingsCalculatorPresentation) -> some View {
        switch presentation {
        case .loading:
            SavingsCalcLoadingView()
        case .empty:
            SavingsCalcEmptyView()
        case .offlineNoData:
            SavingsCalcOfflineView { model.refresh() }
        case let .error(retryable):
            SavingsCalcErrorView(retryable: retryable) { model.refresh() }
        case let .content(projection, _, _):
            SavingsCalculatorComparison(projection: projection)
        }
    }

    @ViewBuilder
    func accessory(for presentation: SavingsCalculatorPresentation) -> some View {
        switch presentation {
        case let .content(_, freshness, refreshing):
            SavingsCalcStatusAccessory(freshness: freshness, refreshing: refreshing) { model.refresh() }
        case .offlineNoData:
            SavingsCalcFreshnessChip(freshness: .offline)
        case .error:
            SavingsCalcFreshnessChip(freshness: .stale)
        case .loading, .empty:
            EmptyView()
        }
    }

    /// Whether the resolved presentation is stale content (drives auto-refresh).
    func isStale(_ presentation: SavingsCalculatorPresentation) -> Bool {
        if case let .content(_, freshness, _) = presentation {
            return freshness == .stale
        }
        return false
    }
}
