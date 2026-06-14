//
//  TelemetryGrid.Views.swift
//  TeslaSync — P4 feature view · 0285 · TelemetryGrid (Apple)
//
//  The reusable view pieces the telemetry grid composes: the i18n `Text` helper, the tone →
//  token mapping, the info tile (web `InfoTile`), the responsive tile grid + its loading
//  skeleton, the surface-level empty / error states, and the freshness chip + connectivity
//  banner the P4 leaf contract layers over the grid. The surface chrome that switches over
//  them lives in TelemetryGrid.swift.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension TelemetryGridStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model
    /// file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Tone mapping (catalog enum → P1/S9 tokens)

extension TGTone {
    /// The value color, mirroring the web `InfoTile` `color` prop: the default primary text,
    /// the battery emerald / amber / rose thresholds, and the muted "off" treatment.
    var color: Color {
        switch self {
        case .primary: Color.TS.textPrimary
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .muted: Color.TS.textMuted
        }
    }
}

// MARK: - Info tile (web `InfoTile`)

/// One telemetry tile: a glass panel with a muted icon + label header, a toned value, and an
/// optional sub-caption (web `InfoTile`). Truncates like the web `truncate` value.
struct TGTileView: View {
    let tile: TelemetryGridTile

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: tile.iconSystemName)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                    Text(verbatim: tile.label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Text(verbatim: tile.value)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(tile.valueTone.color)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if let sub = tile.sub {
                    Text(verbatim: sub)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: tile.spoken))
    }
}

// MARK: - Responsive grid (web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6`)

/// The six-tile responsive grid: two columns on compact widths up to six on wide layouts,
/// matching the web breakpoints. Each tile fades in with a staggered delay (web
/// `StaggerContainer` / `StaggerItem`).
struct TGGrid: View {
    let tiles: [TelemetryGridTile]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(Array(tiles.enumerated()), id: \.element.id) { index, tile in
                TSStaggerItem(index: index) {
                    TGTileView(tile: tile)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf contract)

/// The initial-fetch skeleton: six tile-shaped skeletons in the same responsive grid.
struct TGLoadingGrid: View {
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 6, id: \.self) { _ in
                TSSkeleton(height: 92, cornerRadius: TSRadius.lg)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(TelemetryGridStrings.text("telemetryGrid.loading", "Loading telemetry"))
    }
}

/// The surface-level empty state — no vehicle state at all (the web grid never shows a blank
/// section).
struct TGEmptyView: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(TelemetryGridStrings.string(
                "telemetryGrid.empty.title",
                "No telemetry"
            )),
            message: LocalizedStringKey(TelemetryGridStrings.string(
                "telemetryGrid.empty.message",
                "Vehicle telemetry will appear here once the vehicle reports its state"
            )),
            systemImage: "speedometer"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xl)
    }
}

/// The parent-query failure state with a retry affordance (web `QueryError`).
struct TGErrorView: View {
    let onRetry: () -> Void

    var body: some View {
        TSQueryError(
            message: LocalizedStringKey(TelemetryGridStrings.string(
                "telemetryGrid.error.message",
                "Couldn't load telemetry"
            )),
            onRetry: onRetry
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xl)
    }
}

// MARK: - Freshness chip + connectivity banner (ADR-013 live-state)

/// The freshness chip: a tinted dot, a localized status word, and the relative age. Shown
/// only while stale / offline / fetching so the live grid stays chrome-free.
struct TGFreshnessChip: View {
    let connection: TelemetryGridConnection
    let isFetching: Bool
    let ageLabel: String

    private var tone: Color {
        if isFetching { return Color.TS.accent }
        switch connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.statusDanger
        }
    }

    private var label: String {
        if isFetching {
            return TelemetryGridStrings.string("telemetryGrid.updating", "Updating")
        }
        let word: String = switch connection {
        case .live: TelemetryGridStrings.string("telemetryGrid.live", "Live")
        case .stale: TelemetryGridStrings.string("telemetryGrid.stale", "Stale")
        case .offline: TelemetryGridStrings.string("telemetryGrid.offline", "Offline")
        }
        return "\(word) · \(ageLabel)"
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(TelemetryGridStrings.text("telemetryGrid.freshness.label", "Data freshness"))
        .accessibilityValue(Text(verbatim: label))
    }
}

/// The stale / offline banner above the grid (web reconnecting / offline treatment).
struct TGConnectivityBanner: View {
    let connection: TelemetryGridConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var label: String {
        isOffline
            ? TelemetryGridStrings.string("telemetryGrid.offlineBanner", "Offline — showing last known data")
            : TelemetryGridStrings.string("telemetryGrid.staleBanner", "Reconnecting — data may be stale")
    }

    var body: some View {
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Status bar (freshness chip + manual refresh)

/// The compact freshness row above the grid: the freshness chip + a manual refresh control.
/// Rendered only while stale / offline / fetching so the live grid matches the chrome-free
/// web source.
struct TGStatusBar: View {
    let connection: TelemetryGridConnection
    let isFetching: Bool
    let ageLabel: String
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            TGFreshnessChip(connection: connection, isFetching: isFetching, ageLabel: ageLabel)
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise").font(.system(size: 12, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(TelemetryGridStrings.text("telemetryGrid.refresh", "Refresh"))
        }
    }
}
