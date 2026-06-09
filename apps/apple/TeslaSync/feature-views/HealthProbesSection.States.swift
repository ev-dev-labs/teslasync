//
//  HealthProbesSection.States.swift
//  TeslaSync — P4 feature view · 0244 · HealthProbesSection (Apple)
//
//  The non-content load states composed by `HealthProbesSection`: the initial-fetch
//  skeleton (web two `<Skeleton className="h-36">` in a 1/2 grid), the resolved-but-
//  empty friendly message (no health snapshot — never a blank box), and the fetch-
//  failure error with a retry affordance (web `QueryError`). Copy resolves through the
//  P1/S10 facade; chrome honors Reduce Motion via `TSSkeleton`.
//

import SwiftUI

// MARK: - Loading state (web two `<Skeleton className="h-36">` in `<Grid cols 1/2>`)

/// The initial-fetch skeleton: two card-height blocks in the web `<Grid cols 1/2>`,
/// mirroring the web's two stacked skeletons. Respects Reduce Motion via `TSSkeleton`.
struct HealthProbesLoading: View {
    private let columns = [GridItem(.adaptive(minimum: 260), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            TSSkeleton(height: 144, cornerRadius: TSRadius.md)
            TSSkeleton(height: 144, cornerRadius: TSRadius.md)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(HealthProbesStrings.text("Loading", "Loading health probes"))
    }
}

// MARK: - Empty state (resolved, nothing to show)

/// The resolved-but-empty state — shown only when the load resolved with no health
/// snapshot at all. Never a blank box.
struct HealthProbesEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                HealthProbesStrings.text("No Health Data Title", "No health data")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        } description: {
            HealthProbesStrings.text("No health data available", "No health data available")
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct HealthProbesError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            HealthProbesStrings.text("Couldn't load health probes", "Couldn't load health probes")
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
            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            HealthProbesStrings.text("Retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(HealthProbesStrings.text("Retry", "Retry"))
    }
}
