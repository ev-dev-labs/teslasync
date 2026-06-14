//
//  VehicleHeroCard.Chrome.swift
//  TeslaSync — P4 shared surface · 0233 · VehicleHeroCard (Apple)
//
//  The P4 leaf-state + connectivity chrome the native surface adds so the hero card is never a blank box —
//  the web source has no peer for any of these (it is a presentational component with no loading / empty /
//  error / connectivity handling). The freshness chip + connectivity banner cover the stale / offline axis
//  (cached values stay visible, with a one-tap refresh); the loading skeleton, empty state, and error tile
//  cover the fetch lifecycle. Token-driven (P1/S9); every string resolves through the P1/S10 facade; every
//  interactive element carries a VoiceOver label; Reduce Motion is honored by the underlying `TSSkeleton`.
//

import SwiftUI

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip beside the header when the live state is not live — a colored dot + label (`Stale` /
/// `Offline`) wrapped in a refresh button so VoiceOver and pointer users can re-request the live state.
struct VehicleHeroCardFreshnessChip: View {
    let connection: VehicleHeroCardConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: VehicleHeroCardStrings.live
        case .stale: VehicleHeroCardStrings.stale
        case .offline: VehicleHeroCardStrings.offline
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live: VehicleHeroCardStrings.live
        case .stale: VehicleHeroCardStrings.staleA11y
        case .offline: VehicleHeroCardStrings.offlineA11y
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Refresh button

/// A compact refresh affordance used by the error tile + the connectivity banner.
struct VehicleHeroCardRefreshButton: View {
    let onRefresh: () -> Void

    var body: some View {
        Button(action: onRefresh) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: VehicleHeroCardStrings.refresh))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// An inline banner under the header when the live state is stale or offline — it explains that the visible
/// values may be cached and offers a refresh. Hidden when live.
struct VehicleHeroCardConnectivityBanner: View {
    let connection: VehicleHeroCardConnection
    let onRefresh: () -> Void

    private var message: String? {
        switch connection {
        case .live: nil
        case .stale: VehicleHeroCardStrings.staleBanner
        case .offline: VehicleHeroCardStrings.offlineBanner
        }
    }

    private var tone: Color {
        connection == .stale ? Color.TS.statusWarning : Color.TS.textMuted
    }

    private var symbol: String {
        connection == .stale ? "clock.badge.exclamationmark" : "wifi.slash"
    }

    var body: some View {
        if let message {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: symbol).font(.system(size: 13)).foregroundStyle(tone)
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                VehicleHeroCardRefreshButton(onRefresh: onRefresh)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: message))
        }
    }
}

// MARK: - Loading (initial fetch — skeleton chrome)

/// The initial-fetch state — a skeleton shaped like the hero card (header, gauge row, stat grid) so the panel
/// keeps its footprint while the vehicle resolves, never flashing a blank box.
struct VehicleHeroCardLoading: View {
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 200, height: 24)
                TSSkeleton(width: 150, height: 12)
            }
            HStack(spacing: TSSpacing.x2xl) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(width: 88, height: 88, cornerRadius: TSRadius.pill)
                }
            }
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 56, cornerRadius: TSRadius.md)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: VehicleHeroCardStrings.loadingA11y))
    }
}

// MARK: - Empty (no vehicle resolved)

/// The empty state — a friendly, labelled panel when there is no vehicle to show (web has no peer; the native
/// HIG calls for a labelled state, never a blank box).
struct VehicleHeroCardEmpty: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "car.2")
                .font(.system(size: 32))
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: VehicleHeroCardStrings.emptyTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: VehicleHeroCardStrings.emptyMessage)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xl)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: VehicleHeroCardStrings.emptyTitle))
    }
}

// MARK: - Error (failed read — retry)

/// The fetch-failure state — an icon, the failure title, the runtime message, and a retry button (web has no
/// `QueryError` peer; added so the card never blanks).
struct VehicleHeroCardErrorTile: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: VehicleHeroCardStrings.errorTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                Text(verbatim: VehicleHeroCardStrings.retry)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.accent)
                    .padding(.horizontal, TSSpacing.lg)
                    .padding(.vertical, TSSpacing.sm)
                    .background(Color.TS.accent.opacity(0.12), in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: VehicleHeroCardStrings.retry))
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
    }
}
