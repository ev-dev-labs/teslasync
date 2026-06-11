//
//  TirePressurePanel.Views.swift
//  TeslaSync — P4 feature view · 0286 · TirePressurePanel (Apple)
//
//  Presentational chrome composed by `TirePressurePanel`: the panel header + freshness
//  chip, the stale/offline banner, the four tire tiles (web `grid-cols-2`) with their
//  band-colored value, the single overall status chip (web `allGood`/`anyBad` summary),
//  and the loading / empty / error states. Copy resolves through the P1/S10 facade; chrome
//  is token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Band tone mapping (web `getColor` / `getBorder` → design-system colors)

/// Maps the ported `TPPanelVariant` band tone to the shared design-system colors, so a
/// tile's value + border track the theme and match the rest of the app's status accents.
enum TPPanelTone {
    /// The tile value color (web `getColor`): muted for an unknown corner, else the
    /// success / warning / danger status color.
    static func valueColor(for variant: TPPanelVariant) -> Color {
        switch variant {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .neutral: Color.TS.textMuted
        }
    }

    /// The tile border color (web `getBorder`): the standard hairline for an unknown
    /// corner, else the status color at the web `/30` opacity.
    static func borderColor(for variant: TPPanelVariant) -> Color {
        switch variant {
        case .neutral: Color.TS.border
        default: valueColor(for: variant).opacity(0.3)
        }
    }
}

// MARK: - Header (title + freshness chip)

/// The panel header: the web `Gauge` glyph + the `Tire Pressure` title with the live-state
/// freshness chip trailing.
struct TPPanelHeader: View {
    let connection: TPPanelConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "gauge.medium")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            TPPanelStrings.text("common.tirePressure", "Tire Pressure")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            TPPanelFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct TPPanelFreshnessChip: View {
    let connection: TPPanelConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            TPPanelStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TPPanelStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: TPPanelConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "tirePanel.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "tirePanel.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "tirePanel.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not live, so a
/// cached grid is clearly labeled (web `DataFreshness` intent).
struct TPPanelConnectivityBanner: View {
    let connection: TPPanelConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "tirePanel.offlineBanner" : "tirePanel.staleBanner"
        let fallback = offline
            ? "Offline — showing last known tire pressure"
            : "Reconnecting — tire pressure may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            TPPanelStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Tile (web `grid` cell)

/// One tire tile: the muted short label over the prominent band-colored value, in a
/// band-bordered card (web nested `rounded-xl border bg-white/[0.02] p-4 text-center`).
/// Unlike the vehicle-detail section, the panel has no per-tile status badge — the corner
/// color carries the band and a single chip summarizes all four (web `TirePressureContent`).
struct TPPanelTile: View {
    let reading: TPPanelReading

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            TPPanelStrings.text(reading.corner.labelKey, reading.corner.labelFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Text(verbatim: reading.valueText)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(TPPanelTone.valueColor(for: reading.variant))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .padding(.horizontal, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass.opacity(0.35),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(TPPanelTone.borderColor(for: reading.variant), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        let label = TPPanelStrings.string(reading.corner.accessibilityKey, reading.corner.accessibilityFallback)
        return "\(label), \(reading.valueText)"
    }
}

// MARK: - Tile grid (web `grid grid-cols-2 gap-3`)

/// The four tire tiles in a fixed two-column grid (web `grid-cols-2`).
struct TPPanelGrid: View {
    let readings: [TPPanelReading]

    private let columns = [
        GridItem(.flexible(), spacing: TSSpacing.sm),
        GridItem(.flexible(), spacing: TSSpacing.sm)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.sm) {
            ForEach(readings) { reading in
                TPPanelTile(reading: reading)
            }
        }
    }
}

// MARK: - Overall status chip (web `allGood`/`anyBad` summary)

/// The single status chip below the grid — the native parity of the web summary `<span>`:
/// a leading symbol (✓ / ✗ / ⚠) + the localized status text in the band color, centered.
struct TPPanelOverallChip: View {
    let status: TPPanelOverallStatus

    var body: some View {
        let color = TPPanelTone.valueColor(for: status.variant)
        return HStack(spacing: 0) {
            Spacer(minLength: 0)
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: status.symbolName)
                    .font(.system(size: 12, weight: .semibold))
                    .accessibilityHidden(true)
                TPPanelStrings.text(status.labelKey, status.labelFallback)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .foregroundStyle(color)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(color.opacity(0.1), in: Capsule())
            .overlay(Capsule().strokeBorder(color.opacity(0.3), lineWidth: 1))
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TPPanelStrings.text(status.labelKey, status.labelFallback))
    }
}

// MARK: - Content (web `TirePressureContent` — grid + summary chip)

/// The populated state: the four tiles over the single overall status chip (web
/// `space-y-4` grid then centered summary).
struct TPPanelContent: View {
    let projection: TPPanelProjection

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TPPanelGrid(readings: projection.readings)
            TPPanelOverallChip(status: projection.overall)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a 2×2 grid of muted tile skeletons over a chip
/// skeleton, respecting Reduce Motion (via `TSSkeleton`).
struct TPPanelLoading: View {
    private let columns = [
        GridItem(.flexible(), spacing: TSSpacing.sm),
        GridItem(.flexible(), spacing: TSSpacing.sm)
    ]

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            LazyVGrid(columns: columns, spacing: TSSpacing.sm) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 76, cornerRadius: TSRadius.md)
                }
            }
            TSSkeleton(width: 140, height: 26, cornerRadius: TSRadius.lg)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(TPPanelStrings.text("tirePanel.loading", "Loading tire pressure"))
    }
}

// MARK: - Empty state (web "No tire pressure data available")

/// The resolved-but-absent state: the web no-data sentence over a native
/// `ContentUnavailableView` (gauge glyph + sentence). Never a blank box.
struct TPPanelEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TPPanelStrings.text("tirePanel.noData", "No tire pressure data available")
            } icon: {
                Image(systemName: "gauge.medium")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the inline
/// error treatment used across the feature-view surfaces.
struct TPPanelError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TPPanelStrings.text("tirePanel.errorTitle", "Couldn't load tire pressure")
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
                TPPanelStrings.text("tirePanel.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TPPanelStrings.text("tirePanel.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
