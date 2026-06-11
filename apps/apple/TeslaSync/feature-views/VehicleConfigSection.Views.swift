//
//  VehicleConfigSection.Views.swift
//  TeslaSync — P4 feature view · 0300 · VehicleConfigSection (Apple)
//
//  Presentational chrome composed by `VehicleConfigSection`: the panel header + freshness
//  chip (web `Settings` glyph + "Vehicle Configuration" title), the stale/offline banner, the
//  two-column key/value grid (web `KVList columns={2}`) with its label + value rows, and the
//  loading / empty / error states. Copy resolves through the P1/S10 facade; chrome is
//  token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (title + freshness chip)

/// The panel header: the web `Settings` gear glyph + the "Vehicle Configuration" title with
/// the live-state freshness chip trailing.
struct VCSectionHeader: View {
    let connection: VCSectionConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "gearshape.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            VCSectionStrings.text("vehicles.detail.vehicleConfig", "Vehicle Configuration")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            VCSectionFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct VCSectionFreshnessChip: View {
    let connection: VCSectionConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            VCSectionStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(VCSectionStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: VCSectionConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "configSection.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "configSection.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "configSection.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not live, so a
/// cached configuration is clearly labeled (web `DataFreshness` intent).
struct VCSectionConnectivityBanner: View {
    let connection: VCSectionConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "configSection.offlineBanner" : "configSection.staleBanner"
        let fallback = offline
            ? "Offline — showing last known configuration"
            : "Reconnecting — configuration may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            VCSectionStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Row (web `<div class="flex justify-between py-2">`)

/// One key/value row: the muted label on the leading edge and the prominent value on the
/// trailing edge with a hairline divider below (web `KVList` `divide-y` + `justify-between`).
struct VCSectionRowView: View {
    let row: VCSectionRow

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
                VCSectionStrings.text(row.labelKey, row.labelFallback)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: row.value)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.trailing)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
            .padding(.vertical, TSSpacing.sm)
            Divider().overlay(Color.TS.border)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        let label = VCSectionStrings.string(row.labelKey, row.labelFallback)
        return "\(label), \(row.value)"
    }
}

// MARK: - Grid (web `grid grid-cols-2 gap-x-6`)

/// The twelve key/value rows in a responsive grid: one column on compact width, two on
/// regular (web `KVList columns={2}`, which is a two-column grid on wide layouts).
struct VCSectionGrid: View {
    let projection: VCSectionProjection
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 0) {
            ForEach(projection.rows) { row in
                VCSectionRowView(row: row)
            }
        }
    }

    private var columnCount: Int {
        #if os(iOS)
            sizeClass == .compact ? 1 : 2
        #else
            2
        #endif
    }

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.x2xl, alignment: .top), count: columnCount)
    }
}

// MARK: - Loading state (web `<Skeleton lines={4} />`)

/// The initial-fetch skeleton chrome: a two-column grid of muted label/value row skeletons,
/// respecting Reduce Motion (via `TSSkeleton`).
struct VCSectionLoading: View {
    private let rowCount = 6
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< rowCount, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 90, height: 12)
                    Spacer(minLength: TSSpacing.md)
                    TSSkeleton(width: 64, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(VCSectionStrings.text("configSection.loading", "Loading vehicle configuration"))
    }

    private var columnCount: Int {
        #if os(iOS)
            sizeClass == .compact ? 1 : 2
        #else
            2
        #endif
    }

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.x2xl), count: columnCount)
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The resolved-but-absent state: a friendly `ContentUnavailableView` (gear glyph + sentence)
/// instead of the web skeleton, so the panel is never a blank box.
struct VCSectionEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                VCSectionStrings.text("vehicles.detail.noVehicleConfig", "No configuration data available")
            } icon: {
                Image(systemName: "gearshape.fill")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the inline
/// error treatment used across the feature-view surfaces.
struct VCSectionError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            VCSectionStrings.text("configSection.errorTitle", "Couldn't load vehicle configuration")
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
                VCSectionStrings.text("configSection.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(VCSectionStrings.text("configSection.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
