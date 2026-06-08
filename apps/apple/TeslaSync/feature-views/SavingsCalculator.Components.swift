//
//  SavingsCalculator.Components.swift
//  TeslaSync — P4 feature view · 0118 · SavingsCalculator (Apple)
//
//  The Apple-idiomatic view pieces the surface composes: the labeled assumption
//  fields (ports of the web `<Input suffix=…>`), the "Reset Defaults" action
//  (port of the web `<Button>`), the gas-vs-electric comparison card (port of the
//  inner `<GlassPanel>`s), the freshness + refresh accessory, and the empty /
//  error / offline / loading states (ports of the "Not enough data" message,
//  `QueryError`, the offline fallback, and `Skeleton`). All strings resolve
//  through the P1/S10 facade; all colors/spacing come from the P1/S9 tokens. The
//  assembled comparison grid lives in `SavingsCalculator.Content.swift`.
//

import SwiftUI

// MARK: - Assumption field (port of the web `<Input label=… suffix=…>`)

/// A labeled numeric field with a trailing unit suffix (web `<Input>`). The label
/// carries the unit in parentheses (web `"Gas Price ($/gal)"`); the suffix echoes
/// it inside the field chrome. iOS shows the decimal keypad; macOS uses the
/// standard text field. VoiceOver reads the label as its name and the entry as
/// its value.
struct SavingsAssumptionField: View {
    let label: Text
    let accessibilityName: String
    let suffix: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            label
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            HStack(spacing: TSSpacing.sm) {
                TextField(text: $text, prompt: Text(verbatim: "0")) { label }
                    .labelsHidden()
                    .textFieldStyle(.plain)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .autocorrectionDisabled(true)
                #if os(iOS)
                    .keyboardType(.decimalPad)
                #endif
                Text(verbatim: suffix)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, TSSpacing.sm)
            .frame(minHeight: 40)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityName))
        .accessibilityValue(Text(verbatim: text))
    }
}

// MARK: - Assumptions form (the web "Your Assumptions" column)

/// The "Your Assumptions" input column: the three editable fields + the
/// "Reset Defaults" button. Always rendered (the web inputs are present in every
/// state), so the surface never collapses to a blank box.
struct SavingsAssumptionsForm: View {
    @Binding var gasPriceText: String
    @Binding var mpgText: String
    @Binding var electricityRateText: String
    let onReset: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            SavingsCalculatorStrings.text("costAnalysis.calculator.inputs", "Your Assumptions")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(1)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            SavingsAssumptionField(
                label: SavingsCalculatorStrings.text("costAnalysis.calculator.gasPrice", "Gas Price ($/gal)"),
                accessibilityName: SavingsCalculatorStrings.string(
                    "costAnalysis.calculator.gasPrice",
                    "Gas Price ($/gal)"
                ),
                suffix: SavingsCalculatorStrings.string("costAnalysis.calculator.gasPriceSuffix", "$/gal"),
                text: $gasPriceText
            )
            SavingsAssumptionField(
                label: SavingsCalculatorStrings.text("costAnalysis.calculator.mpg", "Gas Car MPG"),
                accessibilityName: SavingsCalculatorStrings.string("costAnalysis.calculator.mpg", "Gas Car MPG"),
                suffix: SavingsCalculatorStrings.string("costAnalysis.calculator.mpgSuffix", "mpg"),
                text: $mpgText
            )
            SavingsAssumptionField(
                label: SavingsCalculatorStrings.text("costAnalysis.calculator.elecRate", "Electricity Rate ($/kWh)"),
                accessibilityName: SavingsCalculatorStrings.string(
                    "costAnalysis.calculator.elecRate",
                    "Electricity Rate ($/kWh)"
                ),
                suffix: SavingsCalculatorStrings.string("costAnalysis.calculator.elecRateSuffix", "$/kWh"),
                text: $electricityRateText
            )
            TSButton(variant: .secondary, action: onReset) {
                SavingsCalculatorStrings.text("costAnalysis.calculator.reset", "Reset Defaults")
                    .frame(maxWidth: .infinity)
            }
            .padding(.top, TSSpacing.xs)
        }
    }
}

// MARK: - Comparison card (port of the inner `<GlassPanel>`s)

/// One comparison metric card (web inner `<GlassPanel>`): a muted caption, a
/// large tinted value, and a muted sub-caption. Purely visual — the grid in
/// `SavingsCalculator.Content.swift` owns the combined VoiceOver label.
struct SavingsComparisonCard: View {
    let title: Text
    let value: String
    let valueTint: Color
    let caption: String

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                title
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: value)
                    .font(.system(size: 20, weight: .bold))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .foregroundStyle(valueTint)
                Text(verbatim: caption)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Freshness chip + status accessory (live / stale / offline)

/// Header chip flagging live / stale / offline data (native surface contract).
struct SavingsCalcFreshnessChip: View {
    let freshness: SavingsCalculatorFreshness

    private var color: Color {
        switch freshness {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var symbol: String {
        switch freshness {
        case .live: "clock"
        case .stale: "clock.badge.exclamationmark"
        case .offline: "wifi.slash"
        }
    }

    private var label: String {
        switch freshness {
        case .live: SavingsCalculatorStrings.string("calculator.live", "Live")
        case .stale: SavingsCalculatorStrings.string("calculator.stale", "Stale")
        case .offline: SavingsCalculatorStrings.string("calculator.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: symbol).font(.caption2)
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// Freshness chip + an in-flight spinner + a refresh control (web `refetch`).
struct SavingsCalcStatusAccessory: View {
    let freshness: SavingsCalculatorFreshness
    let refreshing: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            SavingsCalcFreshnessChip(freshness: freshness)
            if refreshing {
                ProgressView().controlSize(.mini)
            }
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(SavingsCalculatorStrings.text("calculator.refresh", "Refresh"))
        }
    }
}

// MARK: - Retry affordance (web `QueryError` retry button)

/// Capsule retry button shared by the error + offline states.
struct SavingsCalcRetryButton: View {
    let onRetry: () -> Void

    var body: some View {
        Button(action: onRetry) {
            SavingsCalculatorStrings.text("calculator.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SavingsCalculatorStrings.text("calculator.retry", "Retry"))
    }
}

// MARK: - Empty / error / offline / loading states

/// The "Not enough data for comparison" empty state (web `gasComparison === null`
/// branch) — a friendly centered message, never a blank region.
struct SavingsCalcEmptyView: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            SavingsCalculatorStrings.text("costAnalysis.calculator.noData", "Not enough data for comparison")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 128)
        .accessibilityElement(children: .combine)
    }
}

/// The fetch-failure state (web `QueryError`) with a retry affordance.
struct SavingsCalcErrorView: View {
    let retryable: Bool
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
            SavingsCalculatorStrings.text("calculator.errorTitle", "Couldn't load the comparison")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if retryable {
                SavingsCalcRetryButton(onRetry: onRetry)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 128)
        .padding(TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

/// The offline-without-cache state (web offline fallback) with retry.
struct SavingsCalcOfflineView: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
            SavingsCalculatorStrings.text("calculator.offlineMessage", "Offline — showing your last known comparison")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            SavingsCalcRetryButton(onRetry: onRetry)
        }
        .frame(maxWidth: .infinity, minHeight: 128)
        .padding(TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

/// Skeleton chrome shown during the initial fetch (web `Skeleton`), echoing the
/// four-card comparison grid.
struct SavingsCalcLoadingView: View {
    private var columns: [GridItem] {
        [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 4, id: \.self) { _ in
                TSSkeleton(height: 80, cornerRadius: TSRadius.lg)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 128)
        .accessibilityElement()
        .accessibilityLabel(SavingsCalculatorStrings.text("calculator.loading", "Calculating your savings…"))
    }
}
