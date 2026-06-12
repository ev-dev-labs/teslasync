//
//  VehicleTwin.Chrome.swift
//  TeslaSync — P4 shared surface · 0235 · VehicleTwin (Apple)
//
//  The P4 leaf chrome composed by `VehicleTwin`: the header freshness chip, the refresh button, the
//  stale / offline connectivity banner, the initial-load skeleton, the retryable error view, and the
//  no-vehicle empty state. All consume the P1/S10 facade + the shared P1/S9 tokens — no networking,
//  no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Tone → token mapping

extension VehicleTwinTone {
    /// Maps the semantic legend tone onto the design tokens, so the chips keep status meaning
    /// consistent across paints and light / dark / high-contrast.
    var color: Color {
        switch self {
        case .neutral: Color.TS.textMuted
        case .info: Color.TS.statusInfo
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        }
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct VehicleTwinFreshnessChip: View {
    let connection: VehicleTwinConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: VehicleTwinStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: VehicleTwinStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: VehicleTwinConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "vehicles.twin.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "vehicles.twin.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "vehicles.twin.offline", fallback: "Offline")
        }
    }
}

// MARK: - Refresh button (header)

/// The header refresh affordance — re-requests the snapshot (web refetch peer).
struct VehicleTwinRefreshButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: VehicleTwinStrings.string("vehicles.twin.refresh", "Refresh")))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the content when the bound source is not live, so the
/// surface is clearly labeled while reconnecting / offline.
struct VehicleTwinConnectivityBanner: View {
    let connection: VehicleTwinConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "vehicles.twin.offlineBanner" : "vehicles.twin.staleBanner"
        let fallback = offline
            ? "Offline — showing the last known vehicle state"
            : "Reconnecting — vehicle state may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: VehicleTwinStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading chrome (initial fetch, no cached vehicle)

/// The initial-load chrome: a skeleton silhouette + legend rows that keep the surface shape while the
/// first snapshot resolves.
struct VehicleTwinLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(height: 120)
                .frame(maxWidth: .infinity)
            VehicleTwinWrap(spacing: TSSpacing.sm) {
                ForEach(0 ..< 6, id: \.self) { _ in
                    TSSkeleton(width: 96, height: 24, cornerRadius: TSRadius.pill)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(
            Text(verbatim: VehicleTwinStrings.string("vehicles.twin.loadingA11y", "Loading vehicle digital twin"))
        )
    }
}

// MARK: - Error chrome (initial fetch failed, no cached vehicle)

/// The initial-failure state (no cached vehicle to keep visible) with a retry affordance. Surfaces
/// the failure message under the title when present.
struct VehicleTwinErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: VehicleTwinStrings.string("vehicles.twin.errorTitle", "Couldn’t load vehicle state"))
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
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: VehicleTwinStrings.string("vehicles.twin.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: VehicleTwinStrings.string("vehicles.twin.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty chrome (no vehicle in scope)

/// The no-vehicle empty state — a friendly hint, never a blank box (P4).
struct VehicleTwinEmptyView: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "car.2")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: VehicleTwinStrings.string("vehicles.twin.emptyTitle", "No vehicle selected"))
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: VehicleTwinStrings.string(
                "vehicles.twin.emptyHint",
                "Select a vehicle to see its live physical state."
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
