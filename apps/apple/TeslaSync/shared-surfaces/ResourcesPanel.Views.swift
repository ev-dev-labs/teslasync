//
//  ResourcesPanel.Views.swift
//  TeslaSync — P4 shared surface · 0198 · ResourcesPanel (Apple)
//
//  The presentational pieces of the server-resources panel: the severity → semantic-tone token
//  projection (the web `*-400` bar/text hues), the usage bar, one resource row, and the friendly empty
//  state. All chrome is token-driven (P1/S9); the bar's width transition honours Reduce Motion; no raw
//  hex, no Tailwind ports.
//
//  Web-parity detail, reproduced faithfully:
//    • severity drives BOTH the bar fill AND the value text colour, but DIFFERENTLY for `normal`: the web
//      bar is green (`bg-green-400`) while the web value text stays primary (`text-[var(--text-primary)]`)
//      — so ``barTone`` maps normal → success but ``valueColor`` maps normal → textPrimary. warn / critical
//      share amber / red across both (web `*-400` → shared ``TSTone`` tokens, theme-aware).
//    • the label is the single flexible, truncating run (web `flex-1 truncate`); the value + sub-label
//      hold their intrinsic width (web `shrink-0`), so a long label truncates before the value is squeezed.
//    • the value uses tabular figures (web `tabular-nums` → `.monospacedDigit()`); the sub-label is the
//      muted, lighter run after it (web `ml-1 text-xs text-muted font-normal`).
//    • the bar renders only when a `percent` is supplied (web `percent != null`); its fill animates width
//      changes on the slow motion token (web `transition-all duration-slow`), instant under Reduce Motion.
//    • the empty `rows` case (web's empty `rows.map`) renders a DISCLOSED friendly empty state, never a
//      blank box.
//

import SwiftUI

// MARK: - ResourceSeverity → semantic tone tokens (web bar/text hues)

extension ResourceSeverity {
    /// The bar's semantic tone — the theme-aware token projection of the web bar hues
    /// (`normal → green-400`, `warn → amber-400`, `critical → red-400`). Reuses the shared ``TSTone`` so
    /// the bar recolours across light / dark / high-contrast, where the web fixed `*-400` hues did not.
    var barTone: TSTone {
        switch self {
        case .normal: .success
        case .warn: .warning
        case .critical: .danger
        }
    }

    /// The value text's colour — the web `TEXT` decision, which differs from the bar for `normal`: the
    /// web value text stays primary (NOT green) while warn / critical match the bar (amber / red).
    var valueColor: Color {
        switch self {
        case .normal: Color.TS.textPrimary
        case .warn: TSTone.warning.color
        case .critical: TSTone.danger.color
        }
    }
}

// MARK: - ResourceUsageBar (web `h-1.5` severity bar with `transition-all duration-slow`)

/// The horizontal usage bar — the native peer of the web `ResourceRowItem` progress bar. A faint
/// theme-aware track with a severity-tinted fill whose width is `barWidthPercent` (0–100, already
/// clamped by the projection). The fill animates width changes on the slow motion token (web
/// `transition-all duration-slow`) and snaps instantly under Reduce Motion. Decorative — the row owns the
/// spoken percent — so the bar is hidden from VoiceOver.
struct ResourceUsageBar: View {
    let widthPercent: Double
    let tone: TSTone

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var fraction: CGFloat {
        CGFloat(max(0, min(100, widthPercent)) / 100)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule(style: .continuous)
                    .fill(Color.TS.border)
                Capsule(style: .continuous)
                    .fill(tone.color)
                    .frame(width: geo.size.width * fraction)
                    .animation(TSAnimation.slow(reduceMotion: reduceMotion), value: fraction)
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

// MARK: - ResourceRowView (web `ResourceRowItem` composition)

/// One resource row — the native peer of the web `ResourceRowItem` body. A pure function of its
/// projection + the optional icon slot: it renders the decorative icon, the truncating label, the
/// severity-tinted value with its muted sub-label, and the optional usage bar. The whole row is a single
/// VoiceOver element whose value reads the formatted value, the sub-label, and the bar's percent.
struct ResourceRowView: View {
    let projection: ResourceRowProjection
    let icon: AnyView?

    private var accessibilityValueText: String {
        ResourcesPanelStrings.rowAccessibilityValue(
            value: projection.valueText,
            meta: projection.showsMeta ? projection.metaText : nil,
            percent: projection.accessibilityPercent
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.md) {
                if projection.showsIcon, let icon {
                    icon
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textSecondary)
                        .accessibilityHidden(true)
                }
                Text(projection.label)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                valueRun
            }
            if projection.showsBar {
                ResourceUsageBar(widthPercent: projection.barWidthPercent, tone: projection.severity.barTone)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: projection.label))
        .accessibilityValue(Text(verbatim: accessibilityValueText))
    }

    /// The right-aligned value + optional muted sub-label (web `valueText` + `metaText`), holding its
    /// intrinsic width so the flexible label truncates first.
    private var valueRun: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(projection.valueText)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .monospacedDigit()
                .foregroundStyle(projection.severity.valueColor)
            if projection.showsMeta, let metaText = projection.metaText {
                Text(metaText)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }
}

// MARK: - ResourcesPanelEmptyView (disclosed native peer of the web empty `rows.map`)

/// The friendly empty state shown when `rows` is empty. The web renders an empty container; this is a
/// DISCLOSED native HIG addition so the panel is never a blank box (the prompt's empty-state
/// requirement). Token-driven, centred, and announced as a single VoiceOver element.
struct ResourcesPanelEmptyView: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "tray")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
