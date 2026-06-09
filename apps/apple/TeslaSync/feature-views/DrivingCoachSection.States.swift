//
//  DrivingCoachSection.States.swift
//  TeslaSync — P4 feature view · 0167 · DrivingCoachSection (Apple)
//
//  The load-envelope chrome for the "Driving Coach" section: the initial-fetch skeleton (web skeletons),
//  the resolved-but-empty surface state (web parent "no coach data" branch), and the fetch-failure state
//  with a retry affordance (web `QueryError`). Token-driven (P1/S9); copy via the P1/S10 facade. Never a
//  blank panel.
//

import SwiftUI

// MARK: - Loading state (web skeleton chrome)

/// The initial-fetch skeleton chrome: a redacted gauge card, a redacted trend card, and a redacted table,
/// so the section keeps its shape while the parent query resolves. Respects Reduce Motion (via
/// `TSSkeleton`). Never a blank panel.
struct DrivingCoachSectionLoading: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.lg)],
                alignment: .leading,
                spacing: TSSpacing.lg
            ) {
                gaugeSkeleton
                panelSkeleton(lines: 4)
                panelSkeleton(lines: 3)
            }
            chartSkeleton
            panelSkeleton(lines: 5)
        }
        .accessibilityElement()
        .accessibilityLabel(DrivingCoachSectionStrings.text("dynamics.coach.loading", "Loading driving coach"))
    }

    private var gaugeSkeleton: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 140, height: 140, cornerRadius: 70)
                TSSkeleton(width: 120, height: 10)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func panelSkeleton(lines: Int) -> some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSkeleton(width: 140, height: 14)
                ForEach(0 ..< lines, id: \.self) { _ in
                    TSSkeleton(height: 12)
                }
            }
        }
    }

    private var chartSkeleton: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSkeleton(width: 160, height: 14)
                TSSkeleton(height: 200, cornerRadius: TSRadius.md)
            }
        }
    }
}

// MARK: - Empty state (whole-section, web parent "no coach data yet")

/// The resolved-but-empty surface state (the coach has no analysed drives yet): a friendly
/// `ContentUnavailableView`, never a blank box. Reuses the two web empty strings (`No drives found.` title +
/// `Drive data will appear after your first trip.` hint).
struct DrivingCoachSectionEmpty: View {
    var body: some View {
        TSGlassPanel {
            ContentUnavailableView {
                Label {
                    DrivingCoachSectionStrings.text("dynamics.coach.noDrives", "No drives found.")
                } icon: {
                    Image(systemName: "car")
                }
            } description: {
                DrivingCoachSectionStrings.text(
                    "dynamics.coach.emptyHint",
                    "Drive data will appear after your first trip."
                )
            }
            .frame(maxWidth: .infinity, minHeight: 240)
        }
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the inline error treatment
/// used across the feature-view surfaces.
struct DrivingCoachSectionErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                DrivingCoachSectionStrings.text("dynamics.coach.errorTitle", "Couldn't load driving coach")
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
                    DrivingCoachSectionStrings.text("dynamics.coach.retry", "Retry")
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .padding(.horizontal, TSSpacing.md)
                        .padding(.vertical, TSSpacing.xs)
                        .background(Color.TS.accent.opacity(0.16), in: Capsule())
                        .foregroundStyle(Color.TS.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(DrivingCoachSectionStrings.text("dynamics.coach.retry", "Retry"))
            }
            .frame(maxWidth: .infinity, minHeight: 240)
            .padding(.vertical, TSSpacing.sm)
            .accessibilityElement(children: .combine)
        }
    }
}
