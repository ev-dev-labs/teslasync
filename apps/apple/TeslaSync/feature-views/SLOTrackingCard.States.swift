//
//  SLOTrackingCard.States.swift
//  TeslaSync — P4 feature view · 0253 · SLOTrackingCard (Apple)
//
//  The non-content load states composed by `SLOTrackingCard` for the figure region:
//  the initial-fetch skeleton (web inline "Loading uptime…", widened to skeleton
//  chrome), the resolved-but-empty friendly message (the query returned no figure —
//  never a blank box), and the fetch-failure error with a retry affordance (web
//  "Failed to load uptime data." → the prompt's `QueryError` equivalent). Copy
//  resolves through the P1/S10 facade; chrome honors Reduce Motion via `TSSkeleton`.
//

import SwiftUI

// MARK: - Loading state (web inline "Loading uptime…")

/// The initial-fetch skeleton for the figure region: a tall bar standing in for the
/// big percentage over a thin subtitle bar. Respects Reduce Motion via `TSSkeleton`.
struct SLOTrackingLoading: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 160, height: 34, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 220, height: 12, cornerRadius: TSRadius.sm)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SLOTrackingStrings.string("Loading uptime", "Loading uptime…")))
    }
}

// MARK: - Empty state (resolved, no figure)

/// The resolved-but-empty state — shown only when the uptime query resolves with no
/// figure at all. Never a blank box.
struct SLOTrackingEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: SLOTrackingStrings.string("No Uptime Title", "No uptime data"))
            } icon: {
                Image(systemName: "chart.line.uptrend.xyaxis")
            }
        } description: {
            Text(verbatim: SLOTrackingStrings.string(
                "No uptime data available",
                "No uptime data available for this window yet."
            ))
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web "Failed to load uptime data." → retry)

/// The fetch-failure state with a retry affordance — the prompt's `QueryError`
/// equivalent of the web `error && <p>Failed to load uptime data.</p>`. Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct SLOTrackingError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: SLOTrackingStrings.string(
                "Failed to load uptime data.",
                "Failed to load uptime data."
            ))
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
                Text(verbatim: SLOTrackingStrings.string("Retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: SLOTrackingStrings.string("Retry", "Retry")))
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
