//
//  BackendStatusSection.States.swift
//  TeslaSync — P4 feature view · 0239 · BackendStatusSection (Apple)
//
//  The non-content load states composed by `BackendStatusSection`: the initial-
//  fetch skeleton (web two `<Skeleton>` blocks), the resolved-but-empty friendly
//  message (no components, pool, or runtime — never a blank box), and the fetch-
//  failure error with a retry affordance (web `QueryError`). Copy resolves through
//  the P1/S10 facade; chrome honors Reduce Motion via `TSSkeleton`.
//

import SwiftUI

// MARK: - Loading state (web `<Skeleton className="h-48"/> + h-32`)

/// The initial-fetch skeleton: a tall table block over a shorter pool block,
/// mirroring the web's two stacked skeletons. Respects Reduce Motion via
/// `TSSkeleton`.
struct BackendStatusLoading: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSSkeleton(height: 192, cornerRadius: TSRadius.md)
            TSSkeleton(height: 128, cornerRadius: TSRadius.md)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(BackendStatusStrings.text("Loading", "Loading backend status"))
    }
}

// MARK: - Empty state (resolved, nothing to show)

/// The resolved-but-empty state — shown only when there are no components, no
/// connection pool, and no runtime info at all. Never a blank box.
struct BackendStatusEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                BackendStatusStrings.text("No Backend Status Title", "No backend status")
            } icon: {
                Image(systemName: "server.rack")
            }
        } description: {
            BackendStatusStrings.text(
                "No backend status available",
                "No backend status available"
            )
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct BackendStatusError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            BackendStatusStrings.text("Couldn't load backend status", "Couldn't load backend status")
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
                BackendStatusStrings.text("Retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(BackendStatusStrings.text("Retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
