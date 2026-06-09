//
//  VersionInfoWidget.Components.swift
//  TeslaSync — P4 dashboard widget · 0111 · VersionInfoWidget (Apple)
//
//  The small presentational subviews that map the web shared components to native
//  counterparts, styled with the shared design tokens (the same tokens the shared
//  `TSStatusBadge` / `TSStatCard` use). They are authored locally — rather than
//  reusing the `LocalizedStringKey`-only shared components — so every label
//  resolves through the per-surface `VersionInfoStrings` table (P1/S10) with the
//  web `t(key, default)` fallback, mirroring how the sibling `SystemHealthWidget`
//  builds its chip / tile over the same tokens.
//

import SwiftUI

// MARK: - Key/value row (web `KVList` item)

/// One label/value row: a muted label on the left, the value trailing. Mirrors
/// the web `KVList` row (`flex justify-between`), preserving the web `font-bold`
/// (Version) and `font-mono` (Git SHA) value accents and a 44pt scan target.
struct VersionInfoKVRow: View {
    let label: String
    let item: VersionInfoKVItem

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: item.value)
                .font(item.isMono ? Font.TS.caption.monospaced() : Font.TS.caption)
                .fontWeight(item.isBold ? .bold : .regular)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(item.isMono ? .middle : .tail)
                .minimumScaleFactor(0.7)
        }
        .frame(minHeight: 28)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(item.value)"))
    }
}

// MARK: - Neutral badge (web `Badge variant="neutral"`)

/// The truncated-SHA chip shown in the compact layout: a small monospaced value
/// inside a tonal, bordered capsule. Mirrors the web `Badge variant="neutral"`.
struct VersionInfoBadge: View {
    let value: String

    var body: some View {
        Text(verbatim: value)
            .font(Font.TS.label.monospaced())
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(1)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 3)
            .background(Color.TS.surfaceGlass, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: value))
    }
}

// MARK: - Stat tile (web `StatCard label value` via `WidgetStatGrid`)

/// A compact label + value tile, mirroring the web `StatCard` (`@/components/
/// data-display`) rendered by `WidgetStatGrid`: a muted uppercase label over a
/// bold, monospaced-digit value inside a tonal surface card. The caller
/// pre-formats `value` (fmtNumber/fmtInt/formatBytes).
struct VersionInfoStatTile: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(value)"))
    }
}

// MARK: - Freshness chip (web `DataFreshness` header indicator)

/// Live-stream freshness chip shown in the header: a tone dot + Live/Stale/
/// Offline word. Mirrors the web `DataFreshness` / `FreshnessIndicator`
/// (`@/components/data-display`).
struct VersionInfoFreshnessChip: View {
    let connection: VersionInfoConnection

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: VersionInfoStrings.string("widget.versionInfo.live", "Live")
        case .stale: VersionInfoStrings.string("widget.versionInfo.stale", "Stale")
        case .offline: VersionInfoStrings.string("widget.versionInfo.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}
