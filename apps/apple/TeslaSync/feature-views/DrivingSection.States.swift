//
//  DrivingSection.States.swift
//  TeslaSync — P4 feature view · 0075 · DrivingSection (Apple)
//
//  The load-envelope chrome for the "Driving" section: the initial-fetch skeleton (web skeletons),
//  the resolved-but-empty surface state, and the fetch-failure state with a retry affordance (web
//  `QueryError`). Token-driven (P1/S9); copy via the P1/S10 facade. Never a blank panel.
//

import SwiftUI

// MARK: - Loading state (web skeleton chrome)

/// The initial-fetch skeleton chrome: a redacted chart block, a row of stat-tile skeletons, and a
/// top-drive skeleton, respecting Reduce Motion (via `TSSkeleton`). Never a blank panel.
struct DrivingSectionLoading: View {
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]
    private let barHeights: [CGFloat] = [120, 168, 96, 200, 140, 176, 110]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            DrivingGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSSkeleton(width: 160, height: 12)
                    HStack(alignment: .bottom, spacing: TSSpacing.sm) {
                        ForEach(Array(barHeights.enumerated()), id: \.offset) { _, height in
                            TSSkeleton(width: 18, height: height, cornerRadius: 3)
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(height: 220, alignment: .bottom)
                }
            }
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    DrivingGlassPanel(padding: TSSpacing.md) {
                        HStack(spacing: TSSpacing.md) {
                            TSSkeleton(width: 18, height: 18, cornerRadius: 4)
                            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                                TSSkeleton(width: 70, height: 9)
                                TSSkeleton(width: 96, height: 14)
                            }
                        }
                    }
                }
            }
            DrivingGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSSkeleton(width: 88, height: 18, cornerRadius: TSRadius.sm)
                    TSSkeleton(width: 240, height: 14)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            DrivingSectionStrings.text("analytics.weeklyDigest.driving.loading", "Loading driving summary")
        )
    }
}

// MARK: - Empty state (whole-section, web parent "no driving data")

/// The resolved-but-empty surface state (the bound source delivered no digest): a friendly
/// `ContentUnavailableView`, never a blank box.
struct DrivingSectionEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                DrivingSectionStrings.text("analytics.weeklyDigest.driving.noData", "No driving data for this week")
            } icon: {
                Image(systemName: "car")
            }
        } description: {
            DrivingSectionStrings.text(
                "analytics.weeklyDigest.driving.emptyHint",
                "Drives this week will appear here with distance, efficiency, and your top drive."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 240)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the inline error
/// treatment used across the feature-view surfaces.
struct DrivingSectionErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            DrivingSectionStrings.text("analytics.weeklyDigest.driving.errorTitle", "Couldn't load driving summary")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                DrivingSectionStrings.text("analytics.weeklyDigest.driving.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(DrivingSectionStrings.text("analytics.weeklyDigest.driving.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 240)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
