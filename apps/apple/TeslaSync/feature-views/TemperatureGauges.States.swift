//
//  TemperatureGauges.States.swift
//  TeslaSync — P4 feature view · 0160 · TemperatureGauges (Apple)
//
//  The non-content chrome composed by `TemperatureGauges`: the live-state freshness chip, the
//  stale / offline connectivity banner, the initial-fetch loading grid, the empty state, and the
//  error state (the P4 states contract). All consume pre-localized strings from the P1/S10 facade
//  and the shared P1/S9 tokens + components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline / Updating)

/// The header freshness chip reflecting the bound source's live-state (ADR-013): a tinted dot, a
/// localized label, and an optional relative "updated" stamp.
struct TemperatureGaugesFreshnessChip: View {
    let connection: TemperatureGaugesConnection
    let isFetching: Bool
    let updatedAt: Date?

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if let updatedAt {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(updatedAt, style: .relative)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
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
            return TemperatureGaugesStrings.string("tempGauges.updating", "Updating")
        }
        switch connection {
        case .live: return TemperatureGaugesStrings.string("tempGauges.live", "Live")
        case .stale: return TemperatureGaugesStrings.string("tempGauges.stale", "Stale")
        case .offline: return TemperatureGaugesStrings.string("tempGauges.offline", "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the gauges when the bound source is not live, so cached
/// readings are clearly labeled.
struct TemperatureGaugesConnectivityBanner: View {
    let connection: TemperatureGaugesConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "tempGauges.offlineBanner" : "tempGauges.staleBanner"
        let fallback = offline
            ? "Offline — showing last known temperatures"
            : "Reconnecting — temperatures may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            TemperatureGaugesStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading grid (web `<Skeleton>` chrome)

/// The initial-fetch skeleton grid: four redacted gauge cells in the same responsive layout,
/// respecting Reduce Motion through the shared `TSSkeleton`.
struct TemperatureGaugesLoadingGrid: View {
    var body: some View {
        LazyVGrid(columns: TemperatureGaugesLayout.columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< 4, id: \.self) { _ in
                TemperatureGaugesSkeletonCell()
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel(
            TemperatureGaugesStrings.text("tempGauges.loading", "Loading temperatures")
        )
    }
}

/// One gauge-cell skeleton: a ring-shaped outline over a short label bar and a ceiling bar.
private struct TemperatureGaugesSkeletonCell: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Circle()
                .stroke(Color.TS.textMuted.opacity(0.22), lineWidth: 8)
                .frame(width: 108, height: 108)
            TSSkeleton(width: 72, height: 10)
            TSSkeleton(width: 88, height: 10)
        }
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The resolved-but-no-sensors state: a friendly glyph plus a localized message, never a blank
/// box.
struct TemperatureGaugesEmptyState: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                TemperatureGaugesStrings.string("tempGauges.empty", "No temperature sensors reporting")
            ),
            systemImage: "thermometer.medium.slash"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }
}

// MARK: - Error state (QueryError equivalent)

/// The failure state (the P4 states contract's `QueryError` equivalent): an icon, a title, the
/// optional message, and a retry affordance wired to the model's refresh.
struct TemperatureGaugesErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TemperatureGaugesStrings.text("tempGauges.errorTitle", "Couldn't load temperatures")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                TemperatureGaugesStrings.text("tempGauges.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TemperatureGaugesStrings.text("tempGauges.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
