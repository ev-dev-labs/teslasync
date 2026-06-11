//
//  ElevationProfile.Chrome.swift
//  TeslaSync — P4 shared surface · 0071 · ElevationProfile (Apple)
//
//  The state chrome composed by `ElevationProfilePanel` — the empty / loading / error states the web
//  source + the P4 leaf contract require, plus the freshness chip for the stale / offline connectivity
//  axis. Split out of `ElevationProfile.Views.swift` (one concern per file). Each consumes the P1/S10
//  facade (rendered verbatim) and the shared P1/S9 tokens; none reaches the network. The views are pure
//  functions of their inputs so every branch is exercised by the previews.
//

import SwiftUI

// MARK: - Empty (web `<EmptyState>` — never a blank box)

/// The friendly empty state shown when there is no elevation data — the native parity of the web
/// `<EmptyState message={t('replay.elevation.noData')} />` inside the chart container.
struct ElevationProfileEmptyView: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: ElevationProfileStrings.string("replay.elevation.empty.title", "No elevation data"))
            } icon: {
                Image(systemName: "mountain.2")
            }
        } description: {
            Text(verbatim: message)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Loading (P4 leaf: parent fetch → skeleton)

/// The skeleton chrome shown while the series resolves (web parent fetch) — a title shimmer over a
/// chart-area shimmer that mirrors the populated layout. Shimmer respects Reduce Motion via the shared
/// `TSSkeleton`.
struct ElevationProfileLoadingView: View {
    let height: Double

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 120, height: 12)
            TSSkeleton(height: height, cornerRadius: TSRadius.md)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ElevationProfileStrings.string(
            "replay.elevation.loadingA11y",
            "Loading elevation profile"
        )))
    }
}

// MARK: - Error (web `QueryError` peer)

/// The query-failure state shown when the load fails with no cached value — an inline error with an
/// optional retry affordance (the native peer of the web `QueryError`). Never a blank box (P4).
struct ElevationProfileErrorView: View {
    let message: String
    let showRetry: Bool
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            if showRetry {
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    Text(verbatim: ElevationProfileStrings.string("replay.elevation.error.retry", "Retry"))
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Freshness chip (P4 connectivity axis: stale / offline)

/// The freshness chip shown beside the title when the snapshot is not live — a coloured dot + label
/// that re-requests the data on tap (when a retry handler is wired). Warning tone for stale, muted
/// tone for offline.
struct ElevationProfileFreshnessChip: View {
    let freshness: ElevationProfileFreshness
    let onRefresh: (() -> Void)?

    private var tone: Color {
        freshness.isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    var body: some View {
        Group {
            if let onRefresh {
                Button(action: onRefresh) { chip }
                    .buttonStyle(.plain)
            } else {
                chip
            }
        }
        .accessibilityLabel(Text(verbatim: freshness.accessibilityLabel))
    }

    private var chip: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
            Text(verbatim: freshness.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
        .contentShape(Capsule())
    }
}
