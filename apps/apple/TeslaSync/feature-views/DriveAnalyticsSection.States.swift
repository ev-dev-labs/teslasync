//
//  DriveAnalyticsSection.States.swift
//  TeslaSync — P4 feature view · 0166 · DriveAnalyticsSection (Apple)
//
//  The load-envelope chrome for the "Drive Analytics" section: the initial-fetch skeleton (web
//  skeletons), the resolved-but-empty surface state, and the fetch-failure state with a retry affordance
//  (web `QueryError`). Token-driven (P1/S9); copy via the P1/S10 facade. Never a blank panel.
//

import SwiftUI

// MARK: - Loading state (web skeleton chrome)

/// The initial-fetch skeleton chrome: two redacted chart cards in the responsive pair plus a full-width
/// card, respecting Reduce Motion (via `TSSkeleton`). Never a blank panel.
struct DriveAnalyticsSectionLoading: View {
    private let columns = [GridItem(.adaptive(minimum: 320), spacing: TSSpacing.lg)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
                chartSkeleton
                chartSkeleton
            }
            chartSkeleton
        }
        .accessibilityElement()
        .accessibilityLabel(
            DriveAnalyticsSectionStrings.text("dynamics.loading", "Loading drive analytics")
        )
    }

    private var chartSkeleton: some View {
        DriveAnalyticsSectionGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSkeleton(width: 160, height: 14)
                TSSkeleton(width: 220, height: 10)
                HStack(alignment: .bottom, spacing: TSSpacing.sm) {
                    ForEach([120.0, 168.0, 96.0, 200.0, 140.0], id: \.self) { height in
                        TSSkeleton(width: 26, height: height, cornerRadius: 3)
                    }
                    Spacer(minLength: 0)
                }
                .frame(height: 210, alignment: .bottom)
            }
        }
    }
}

// MARK: - Empty state (whole-section, web parent "no drives in range")

/// The resolved-but-empty surface state (the selected window has no drives): a friendly
/// `ContentUnavailableView`, never a blank box.
struct DriveAnalyticsSectionEmpty: View {
    var body: some View {
        DriveAnalyticsSectionGlassPanel {
            ContentUnavailableView {
                Label {
                    DriveAnalyticsSectionStrings.text("dynamics.noDrives", "No drives in this range")
                } icon: {
                    Image(systemName: "car")
                }
            } description: {
                DriveAnalyticsSectionStrings.text(
                    "dynamics.emptyHint",
                    "Drives in the selected window will appear here as speed, acceleration, and power charts."
                )
            }
            .frame(maxWidth: .infinity, minHeight: 240)
        }
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the inline error
/// treatment used across the feature-view surfaces.
struct DriveAnalyticsSectionErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        DriveAnalyticsSectionGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                DriveAnalyticsSectionStrings.text("dynamics.errorTitle", "Couldn't load drive analytics")
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
                    DriveAnalyticsSectionStrings.text("dynamics.retry", "Retry")
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .padding(.horizontal, TSSpacing.md)
                        .padding(.vertical, TSSpacing.xs)
                        .background(Color.TS.accent.opacity(0.16), in: Capsule())
                        .foregroundStyle(Color.TS.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(DriveAnalyticsSectionStrings.text("dynamics.retry", "Retry"))
            }
            .frame(maxWidth: .infinity, minHeight: 240)
            .padding(.vertical, TSSpacing.sm)
            .accessibilityElement(children: .combine)
        }
    }
}
