//
//  InfrastructureSection.States.swift
//  TeslaSync — P4 feature view · 0248 · InfrastructureSection (Apple)
//
//  The non-content load states composed by `InfrastructureSection`: the initial-fetch
//  skeleton (web has no live feed, so the brief skeleton is the native-idiomatic
//  initial-mount affordance), the resolved-but-empty friendly message (no telemetry
//  read AND no database pool — never a blank box), and the fetch-failure error with a
//  retry affordance (web `QueryError`). Copy resolves through the P1/S10 facade; chrome
//  honors Reduce Motion via `TSSkeleton`.
//

import SwiftUI

// MARK: - Loading state (initial fetch skeleton)

/// The initial-fetch skeleton: two card-height blocks over a shorter metric block,
/// mirroring the two cards + pool row the content resolves to. Respects Reduce Motion
/// via `TSSkeleton`.
struct InfrastructureLoading: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                TSSkeleton(height: 168, cornerRadius: TSRadius.lg)
                TSSkeleton(height: 168, cornerRadius: TSRadius.lg)
            }
            TSSkeleton(height: 72, cornerRadius: TSRadius.md)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(InfrastructureStrings.text("Loading", "Loading infrastructure status"))
    }
}

// MARK: - Empty state (resolved, nothing to show)

/// The resolved-but-empty state — shown only when there is no telemetry read and no
/// database pool at all. Never a blank box.
struct InfrastructureEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                InfrastructureStrings.text("No Infrastructure Title", "No infrastructure data")
            } icon: {
                Image(systemName: "globe")
            }
        } description: {
            InfrastructureStrings.text("No Infrastructure Message", "No infrastructure data available")
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct InfrastructureError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            InfrastructureStrings.text("Infrastructure Error Title", "Couldn't load infrastructure status")
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
                InfrastructureStrings.text("Retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(InfrastructureStrings.text("Retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
