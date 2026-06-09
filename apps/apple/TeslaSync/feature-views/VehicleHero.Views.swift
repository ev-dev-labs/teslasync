//
//  VehicleHero.Views.swift
//  TeslaSync — P4 feature view · 0133 · VehicleHero (Apple)
//
//  The semantic colour/tone resolution and the identity-header chrome for the hero —
//  the vehicle name, the status badge (web `StatusBadge`), the freshness chip (web
//  `FreshnessIndicator`), the "{model} {trim} · {vin}" line, and the connectivity
//  banner. The gauge / stat / action subviews live in the sibling
//  `VehicleHero.GaugeViews.swift` / `VehicleHero.States.swift`.
//
//  Colour parity (ADR-006 semantic, not literal): each web per-item hex maps to a
//  P1/S9 design token through `VehicleHeroPanelPalette.color(_:)`; the status badge
//  tone maps through `VehicleHeroPanelPalette.tone(_:)`. No raw hex, no Tailwind ports,
//  no networking here.
//

import SwiftUI

// MARK: - Semantic colour + tone resolution (web hex → P1/S9 tokens)

/// Resolves the surface's accent roles + status to design-token colours / tones. A
/// namespaced enum (rather than free functions) so the helpers never collide with the
/// SwiftUI `View.accentColor(_:)` modifier inside view bodies.
enum VehicleHeroPanelPalette {
    /// Maps a gauge / stat-card accent role to its design-token colour.
    static func color(_ accent: VehicleHeroPanelAccent) -> Color {
        switch accent {
        case .battery, .chargePower: Color.TS.chartSeriesBattery
        case .batteryLow, .power, .unlocked, .timeToFull: Color.TS.statusWarning
        case .range, .idealRange, .firmware: Color.TS.accent
        case .speed, .odometer: Color.TS.chartSeriesPower
        case .tempInside: Color.TS.chartSeriesEnergy
        case .tempOutside: Color.TS.chartSeriesSpeed
        case .powerRegen, .chargeRate, .locked: Color.TS.statusSuccess
        case .powerIdle, .sentryOff: Color.TS.textMuted
        case .sentryOn: Color.TS.statusDanger
        }
    }

    /// Maps a vehicle status to the badge tone (web FSM `variant`).
    static func tone(_ status: VehicleHeroPanelStatus) -> TSTone {
        switch status {
        case .online, .driving: .success
        case .charging: .warning
        case .parked, .updating: .info
        case .asleep: .neutral
        case .offline: .danger
        }
    }
}

// MARK: - Header (web name + StatusBadge + FreshnessIndicator + model/vin line)

/// The always-visible identity header — the vehicle name, the status badge, the
/// freshness chip, and the "{model} {trim} · {vin}" line.
struct VehicleHeroPanelHeaderView: View {
    let header: VehicleHeroPanelHeader
    let connection: VehicleHeroPanelConnection
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: header.title)
                    .font(Font.TS.title)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                statusBadge
                Spacer(minLength: TSSpacing.sm)
                VehicleHeroPanelFreshnessChip(connection: connection, updatedAt: header.updatedAt)
                refreshButton
            }
            subtitle
        }
    }

    private var statusBadge: some View {
        let label = VehicleHeroPanelStrings.string(header.status.labelKey, header.status.labelFallback)
        let tone = VehicleHeroPanelPalette.tone(header.status)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(tone.color).frame(width: 8, height: 8)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: VehicleHeroPanelAccessibility.headerLabel(
            title: header.title, status: label
        )))
    }

    private var refreshButton: some View {
        Button(action: onRefresh) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: VehicleHeroPanelStrings.string("hero.refresh", "Refresh")))
    }

    @ViewBuilder
    private var subtitle: some View {
        let prefix = [header.model, header.trimBadging].filter { !$0.isEmpty }.joined(separator: " ")
        HStack(spacing: TSSpacing.xs) {
            if !prefix.isEmpty {
                Text(verbatim: prefix + " ·")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Text(verbatim: header.vin)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The header freshness chip — the connection state (live / stale / offline) plus the
/// relative age of the bound data (web `FreshnessIndicator`).
struct VehicleHeroPanelFreshnessChip: View {
    let connection: VehicleHeroPanelConnection
    let updatedAt: Date?

    var body: some View {
        let freshness = VehicleHeroPanelFreshness.describe(updatedAt: updatedAt, now: Date())
        let tone = chipTone
        let label = chipLabel
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: "\(label) · \(freshness.token)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var chipTone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var chipLabel: String {
        switch connection {
        case .live: VehicleHeroPanelStrings.string("hero.live", "Live")
        case .stale: VehicleHeroPanelStrings.string("hero.stale", "Stale")
        case .offline: VehicleHeroPanelStrings.string("hero.offline", "Offline")
        }
    }
}

/// The reconnecting / offline banner shown when the feed is not live (P4 contract).
struct VehicleHeroPanelConnectivityBanner: View {
    let connection: VehicleHeroPanelConnection

    var body: some View {
        let isOffline = connection == .offline
        let label = isOffline
            ? VehicleHeroPanelStrings.string("hero.offlineBanner", "Offline — showing last known data")
            : VehicleHeroPanelStrings.string("hero.staleBanner", "Reconnecting — data may be stale")
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: label)
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
