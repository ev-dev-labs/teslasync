//
//  AutopilotSection.States.swift
//  TeslaSync — P4 feature view · 0165 · AutopilotSection (Apple)
//
//  The load-envelope chrome for the "Autopilot & Cruise" section: the initial-fetch skeleton (three
//  redacted tiles), the resolved-but-empty surface state (web `EmptyState`), and the fetch-failure
//  state with a retry affordance (web `QueryError`). Token-driven (P1/S9); copy via the P1/S10 facade.
//  Never a blank panel.
//

import SwiftUI

// MARK: - Loading state (web skeleton chrome)

/// One redacted skeleton tile. Static bars (no shimmer) so it is reduce-motion-safe by construction.
struct AutopilotSkeletonTile: View {
    private var bar: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.border.opacity(0.3))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            bar.frame(width: 72, height: 9)
            bar.frame(width: 96, height: 20)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// The initial-fetch skeleton grid (web `<Skeleton>` shell): three redacted tiles in the same
/// responsive grid as the content. Never a blank panel.
struct AutopilotSectionLoading: View {
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< 3, id: \.self) { _ in
                AutopilotSkeletonTile()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            AutopilotSectionStrings.text("dynamics.autopilot.loading", "Loading cruise and autopilot telemetry")
        )
    }
}

// MARK: - Empty state (web `<EmptyState message={t('dynamics.autopilotNoData')} />`)

/// The resolved-but-empty surface state (no cruise / autopilot telemetry yet): a friendly
/// `ContentUnavailableView`, never a blank box. Reproduces the web `EmptyState` message verbatim.
struct AutopilotSectionEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                AutopilotSectionStrings.text(
                    "dynamics.autopilotNoData",
                    "No cruise / autopilot telemetry received yet"
                )
            } icon: {
                Image(systemName: "gauge.with.dots.needle.0percent")
            }
        } description: {
            AutopilotSectionStrings.text(
                "dynamics.autopilot.emptyHint",
                "Current speed, cruise set speed, and follow distance appear here while Autopilot or cruise is active."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 180)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Surfaces the failure message
/// under the title when present, and mirrors the inline error treatment used across the feature-view
/// surfaces.
struct AutopilotSectionErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            AutopilotSectionStrings.text("dynamics.autopilot.errorTitle", "Couldn't load cruise telemetry")
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
                AutopilotSectionStrings.text("dynamics.autopilot.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(AutopilotSectionStrings.text("dynamics.autopilot.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
