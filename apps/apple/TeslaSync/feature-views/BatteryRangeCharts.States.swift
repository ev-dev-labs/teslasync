//
//  BatteryRangeCharts.States.swift
//  TeslaSync — P4 feature view · 0288 · BatteryRangeCharts (Apple)
//
//  The non-content state chrome composed by `BatteryRangeCharts` (split out of
//  BatteryRangeCharts.Views.swift to keep both files within the file-length budget): the
//  initial-fetch loading skeletons for the Battery Overview + Drive Distance Trend panels, the
//  surface-level empty state (web `EmptyState` peer), and the QueryError-equivalent failure with
//  retry. All consume pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens;
//  no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Loading skeletons (native chrome — initial fetch)

/// The Battery Overview loading body: a circular gauge block beside two tile blocks, over a row
/// of muted bars — mirroring the resolved layout. Respects Reduce Motion via `TSSkeleton`.
struct BatteryRangeChartsBatteryLoadingBody: View {
    private let barHeights: [CGFloat] = [120, 64]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .center, spacing: TSSpacing.lg) {
                TSSkeleton(width: 104, height: 104, cornerRadius: 52)
                VStack(spacing: TSSpacing.sm) {
                    TSSkeleton(height: 56, cornerRadius: TSRadius.lg)
                    TSSkeleton(height: 56, cornerRadius: TSRadius.lg)
                }
                .frame(maxWidth: .infinity)
            }
            HStack(alignment: .bottom, spacing: TSSpacing.x3xl) {
                ForEach(Array(barHeights.enumerated()), id: \.offset) { _, height in
                    TSSkeleton(width: 48, height: height, cornerRadius: TSRadius.sm)
                }
                Spacer(minLength: 0)
            }
            .frame(height: 132, alignment: .bottom)
        }
        .accessibilityElement()
        .accessibilityLabel(
            BatteryRangeChartsStrings.text("vehicles.detail.loadingA11y", "Loading battery and range")
        )
    }
}

/// The Drive Distance Trend loading body: a single chart block skeleton.
struct BatteryRangeChartsDriveLoadingBody: View {
    var body: some View {
        TSChartSkeleton(height: 208)
            .accessibilityElement()
            .accessibilityLabel(
                BatteryRangeChartsStrings.text("vehicles.detail.driveLoadingA11y", "Loading drive trend")
            )
    }
}

// MARK: - Empty state (surface-level — no vehicle-state snapshot)

/// The friendly surface-level empty state shown when no vehicle-state snapshot is known. Uses the
/// Apple-idiomatic `ContentUnavailableView` so the surface never reads as a blank panel.
struct BatteryRangeChartsEmptyState: View {
    var body: some View {
        TSGlassPanel {
            ContentUnavailableView {
                Label {
                    BatteryRangeChartsStrings.text("vehicles.detail.noBatteryData", "No battery data available")
                } icon: {
                    Image(systemName: "minus.plus.batteryblock.slash")
                }
            } description: {
                BatteryRangeChartsStrings.text(
                    "vehicles.detail.noBatteryDataHint",
                    "Battery and range charts will appear here once vehicle data is available."
                )
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.x2xl)
        }
    }
}

// MARK: - Error state (web `QueryError` equivalent + retry)

/// The no-cached-data failure state (web `QueryError`): a danger glyph, the failure title, the
/// underlying message, and a retry affordance wired to the model.
struct BatteryRangeChartsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                BatteryRangeChartsStrings.text("vehicles.detail.errorTitle", "Couldn't load battery and range")
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    BatteryRangeChartsStrings.text("vehicles.detail.retry", "Retry")
                }
                .accessibilityLabel(BatteryRangeChartsStrings.text("vehicles.detail.retry", "Retry"))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.lg)
            .accessibilityElement(children: .combine)
        }
    }
}
