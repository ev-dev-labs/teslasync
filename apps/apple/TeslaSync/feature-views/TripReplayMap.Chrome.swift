//
//  TripReplayMap.Chrome.swift
//  TeslaSync — P4 feature view · 0274 · TripReplayMap (Apple)
//
//  The non-map chrome composed by `TripReplayMap`: the stale/offline freshness chip
//  overlaid on the map, the stationary-GPS banner (web `AlertBanner` — "Route can't be
//  plotted"), the friendly empty state (web `EmptyState` — "No position data available
//  for this drive"), the hard-error retry body (the P4 leaf addition; the web parent
//  owns fetching), and the loading skeleton map. All consume the P1/S10 facade + the
//  shared P1/S9 tokens — never a blank box, never a literal.
//

import SwiftUI

// MARK: - Freshness chip (native chrome for stale / offline / updating)

/// A compact chip shown over the map when the feed is fetching, stale, or offline. The
/// last-loaded route stays visible; the chip offers a manual refresh.
struct TripReplayFreshnessChip: View {
    let connection: TripReplayMapConnection
    let isFetching: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            if connection != .live {
                Button(action: onRefresh) {
                    TripReplayMapStrings.text("replay.map.refresh", "Refresh")
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(TripReplayMapStrings.text("replay.map.refresh", "Refresh"))
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private var tone: Color {
        if isFetching { return Color.TS.accent }
        switch connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.textMuted
        }
    }

    private var label: String {
        if isFetching {
            return TripReplayMapStrings.string("replay.map.updating", "Updating")
        }
        switch connection {
        case .live: return TripReplayMapStrings.string("replay.map.live", "Live")
        case .stale: return TripReplayMapStrings.string("replay.map.stale", "Reconnecting")
        case .offline: return TripReplayMapStrings.string("replay.map.offline", "Offline")
        }
    }
}

// MARK: - Stationary-GPS banner (web `AlertBanner` overlay)

/// The "Route can't be plotted" overlay shown when only one GPS coordinate was recorded
/// (web `!hasRoute` `AlertBanner`). Carries the web title + body verbatim; pinned over
/// the map so the panel still reads as a map (not an empty state).
struct TripReplayStationaryBanner: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "location.slash")
                .foregroundStyle(Color.TS.statusInfo)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                TripReplayMapStrings.text("replay.map.stationaryRouteTitle", "Route can't be plotted")
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                TripReplayMapStrings.text(
                    "replay.map.stationaryRouteBody",
                    "Only one GPS coordinate was recorded for this drive, so the route can't be drawn. "
                        + "The trip statistics, speed, and elevation timeline above the scrubber are unaffected."
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusInfo.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The "No position data available for this drive" body — the native parity of the web
/// `EmptyState`, shown when there are no positions (web `positions.length === 0`).
/// Carries the web copy + a pin-slash glyph; never a blank box.
struct TripReplayEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TripReplayMapStrings.text("replay.map.noPositions", "No position data available for this drive")
            } icon: {
                Image(systemName: "mappin.slash")
            }
        }
        .frame(maxWidth: .infinity, minHeight: TripReplayMapMetrics.canvasHeight)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Hard-error state (the P4 leaf retry addition)

/// The error body: a danger glyph, the failure copy + the underlying message, and a
/// Retry control wired to `model.refresh()`. The web parent owns fetching, so this is
/// the native leaf's resilient addition for the prompt's `error` state.
struct TripReplayErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 30))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TripReplayMapStrings.text("replay.map.errorTitle", "Couldn't load the replay map")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: TripReplayMapMetrics.canvasHeight)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        let title = TripReplayMapStrings.string("replay.map.retry", "Retry")
        return TSButton(variant: .secondary, size: .small, action: onRetry) {
            Text(verbatim: title).lineLimit(1)
        }
        .accessibilityLabel(Text(verbatim: title))
    }
}

// MARK: - Loading skeleton (initial-fetch chrome)

/// The initial-load skeleton: a redacted map block with a pill chip so the transition
/// into the loaded map is stable. Reduce-Motion safe via the shared `TSSkeleton`.
struct TripReplaySkeleton: View {
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            TSSkeleton(width: nil, height: TripReplayMapMetrics.canvasHeight, cornerRadius: TSRadius.lg)
            HStack(spacing: TSSpacing.xs) {
                TSSkeleton(width: 96, height: 26, cornerRadius: TSRadius.pill)
                TSSkeleton(width: 70, height: 26, cornerRadius: TSRadius.pill)
            }
            .padding(TSSpacing.md)
        }
        .accessibilityElement()
        .accessibilityLabel(TripReplayMapStrings.text("replay.map.loading", "Loading replay map"))
    }
}
