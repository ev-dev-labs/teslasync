//
//  TirePressureSection.Views.swift
//  TeslaSync — P4 feature view · 0299 · TirePressureSection (Apple)
//
//  Presentational chrome composed by `TirePressureSection`: the panel header + freshness
//  chip, the stale/offline banner, the four tire tiles (web `grid-cols-2 sm:grid-cols-4`)
//  with their value + status badge, and the loading / empty / error states. Copy resolves
//  through the P1/S10 facade; chrome is token-driven (P1/S9). No networking and no
//  Tailwind ports live here.
//

import SwiftUI

// MARK: - Badge tone mapping (web `Badge variant` → design-system `TSTone`)

/// Maps the ported `tirePressureVariant` tone to the shared design-system `TSTone`, so a
/// tile's badge tracks the theme and matches the rest of the app's status chips.
enum TPSectionTone {
    static func tone(for variant: TPSectionVariant) -> TSTone {
        switch variant {
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        case .neutral: .neutral
        }
    }
}

// MARK: - Header (title + freshness chip)

/// The panel header: the web `CircleDot` glyph + the `Tire Pressure` title with the
/// live-state freshness chip trailing.
struct TPSectionHeader: View {
    let connection: TPSectionConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "smallcircle.filled.circle")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            TPSectionStrings.text("vehicles.detail.tirePressure", "Tire Pressure")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            TPSectionFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct TPSectionFreshnessChip: View {
    let connection: TPSectionConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            TPSectionStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TPSectionStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: TPSectionConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "tireSection.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "tireSection.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "tireSection.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not live, so a
/// cached grid is clearly labeled (web `DataFreshness` intent).
struct TPSectionConnectivityBanner: View {
    let connection: TPSectionConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "tireSection.offlineBanner" : "tireSection.staleBanner"
        let fallback = offline
            ? "Offline — showing last known tire pressure"
            : "Reconnecting — tire pressure may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            TPSectionStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Status chip (web `Badge`)

/// One tile's status badge — the native parity of the web `<Badge variant size="sm">`,
/// reusing the shared `TSTone` palette with copy resolved through the P1/S10 facade.
struct TPSectionStatusChip: View {
    let status: TPSectionStatus

    var body: some View {
        let color = TPSectionTone.tone(for: status.variant).color
        return TPSectionStrings.text(status.labelKey, status.labelFallback)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(color.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Tile (web `grid` cell)

/// One tire tile: the muted corner label over the prominent converted value over the
/// status badge, in a hairline-bordered card (web nested `GlassPanel p-4 text-center`).
struct TPSectionTileView: View {
    let reading: TPSectionReading

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            TPSectionStrings.text(reading.corner.labelKey, reading.corner.labelFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            Text(verbatim: reading.valueText)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            TPSectionStatusChip(status: reading.status)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .padding(.horizontal, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        let label = TPSectionStrings.string(reading.corner.labelKey, reading.corner.labelFallback)
        let status = TPSectionStrings.string(reading.status.labelKey, reading.status.labelFallback)
        return "\(label), \(reading.valueText), \(status)"
    }
}

// MARK: - Tile grid (web `grid-cols-2 gap-4 sm:grid-cols-4`)

/// The four tire tiles in a responsive grid: two columns on compact width, four on
/// regular (web `grid-cols-2 sm:grid-cols-4`).
struct TPSectionGrid: View {
    let projection: TPSectionProjection
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(projection.readings) { reading in
                TPSectionTileView(reading: reading)
            }
        }
    }

    private var columnCount: Int {
        #if os(iOS)
            sizeClass == .compact ? 2 : 4
        #else
            4
        #endif
    }

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: columnCount)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a row of four muted tile skeletons, respecting
/// Reduce Motion (via `TSSkeleton`).
struct TPSectionLoading: View {
    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: TSSpacing.md),
        count: 4
    )

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 4, id: \.self) { _ in
                TSSkeleton(height: 92, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(TPSectionStrings.text("tireSection.loading", "Loading tire pressure"))
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The resolved-but-absent state: the web `EmptyState` (CircleDot glyph + sentence) over
/// a native `ContentUnavailableView`. Never a blank box.
struct TPSectionEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TPSectionStrings.text("vehicles.detail.noTireData", "No tire pressure data available")
            } icon: {
                Image(systemName: "smallcircle.filled.circle")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the inline
/// error treatment used across the feature-view surfaces.
struct TPSectionError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TPSectionStrings.text("tireSection.errorTitle", "Couldn't load tire pressure")
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
                TPSectionStrings.text("tireSection.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TPSectionStrings.text("tireSection.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
