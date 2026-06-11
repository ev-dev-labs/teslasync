//
//  BatteryRangePanel.States.swift
//  TeslaSync — P4 feature view · 0289 · BatteryRangePanel (Apple)
//
//  The non-content state chrome composed by `BatteryRangePanel`: the initial-fetch loading skeleton,
//  the empty state (web `EmptyState` peer), the QueryError-equivalent failure with retry, the
//  freshness chip, and the stale / offline connectivity banner. All consume pre-localized strings
//  from the P1/S10 facade and the shared P1/S9 tokens; no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Loading skeleton (native chrome — initial fetch)

/// The in-flight skeleton: a circular gauge block beside three metric-card blocks, mirroring the
/// resolved panel layout. Respects Reduce Motion via the shared `TSSkeleton`.
struct BatteryRangePanelLoadingContent: View {
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.x2xl) {
                gaugeSkeleton
                cardSkeletons
            }
            VStack(alignment: .center, spacing: TSSpacing.lg) {
                gaugeSkeleton
                cardSkeletons
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            BatteryRangePanelStrings.text("vehicles.battery.loadingA11y", "Loading battery and range")
        )
    }

    private var gaugeSkeleton: some View {
        TSSkeleton(width: 140, height: 140, cornerRadius: 70)
    }

    private var cardSkeletons: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 64, cornerRadius: TSRadius.lg)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Empty state (web `EmptyState` peer)

/// The friendly empty state shown when no vehicle-state snapshot is known. Uses the Apple-idiomatic
/// `ContentUnavailableView` so the surface never reads as a blank panel.
struct BatteryRangePanelEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: BatteryRangePanelStrings.string(
                    "vehicles.battery.noData",
                    "No battery data available"
                ))
            } icon: {
                Image(systemName: "minus.plus.batteryblock.slash")
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x2xl)
    }
}

// MARK: - Error state (web `QueryError` equivalent + retry)

/// The no-cached-data failure state (web `QueryError`): a danger glyph, the failure title, the
/// underlying message, and a retry affordance wired to the model.
struct BatteryRangePanelErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            BatteryRangePanelStrings.text("vehicles.battery.errorTitle", "Couldn't load battery status")
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                BatteryRangePanelStrings.text("vehicles.battery.retry", "Retry")
            }
            .accessibilityLabel(BatteryRangePanelStrings.text("vehicles.battery.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013). Shown only when the source
/// is not live, so the normal panel stays as clean as the web source (which has no chrome).
struct BatteryRangePanelFreshnessChip: View {
    let connection: BatteryRangePanelConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: BatteryRangePanelStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: BatteryRangePanelStrings.string(descriptor.key, descriptor.fallback))
        )
    }

    private static func descriptor(for connection: BatteryRangePanelConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "vehicles.battery.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "vehicles.battery.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "vehicles.battery.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the content when the bound source is not live, so the
/// last-known snapshot is clearly labeled as cached. A manual refresh affordance accompanies the
/// stale state (offline has no connectivity to retry over).
struct BatteryRangePanelConnectivityBanner: View {
    let connection: BatteryRangePanelConnection
    let onRefresh: () -> Void

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: descriptor.systemImage)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(descriptor.tone)
                .accessibilityHidden(true)
            Text(verbatim: BatteryRangePanelStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            if connection == .stale {
                TSButton(variant: .ghost, size: .small, action: onRefresh) {
                    BatteryRangePanelStrings.text("vehicles.battery.refresh", "Refresh")
                }
                .accessibilityLabel(BatteryRangePanelStrings.text("vehicles.battery.refresh", "Refresh"))
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            descriptor.tone.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
        let systemImage: String
    }

    private static func descriptor(for connection: BatteryRangePanelConnection) -> Descriptor {
        switch connection {
        case .offline:
            Descriptor(
                tone: Color.TS.textMuted,
                key: "vehicles.battery.offlineBanner",
                fallback: "Offline — showing last known battery status",
                systemImage: "wifi.slash"
            )
        case .stale:
            Descriptor(
                tone: Color.TS.statusWarning,
                key: "vehicles.battery.staleBanner",
                fallback: "Reconnecting — battery status may be stale",
                systemImage: "clock.arrow.circlepath"
            )
        case .live:
            Descriptor(
                tone: Color.TS.statusSuccess,
                key: "vehicles.battery.live",
                fallback: "Live",
                systemImage: "checkmark.circle"
            )
        }
    }
}
