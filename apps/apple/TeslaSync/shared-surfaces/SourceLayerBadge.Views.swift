//
//  SourceLayerBadge.Views.swift
//  TeslaSync — P4 shared surface · 0105 · SourceLayerBadge (Apple)
//
//  The presentational subviews composed by `SourceLayerBadge`: the tinted glyph chip (the native
//  parity of the web `<span class="rounded … font-mono uppercase …">` with the per-layer `STYLE`
//  tints), the offline marker (P4 connectivity decoration), the resolved readout row, the neutral
//  loading skeleton chip, and the neutral unavailable / retry chip. All copy resolves through the
//  P1/S10 facade; all color comes from the P1/S9 tokens; the shared `TSSkeleton` / `TSButton`
//  primitives are reused. No networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Layer → tint mapping (web per-layer `STYLE.tint`)

/// The resolved chip colors for a layer — the native port of the web `STYLE[key].tint`. Tinted
/// layers (l1 → success/emerald, l2 → info/blue, stale → warning/amber) wash their semantic token at
/// the web `/15` fill and `/30` border; the neutral layers (log, unknown) use the muted surface and
/// secondary-text tokens (the web `var(--surface-2)` / `var(--text-secondary)` neutral badge).
struct SourceLayerBadgeChipStyle {
    let fill: Color
    let stroke: Color
    let text: Color

    static func tinted(_ tone: Color) -> SourceLayerBadgeChipStyle {
        SourceLayerBadgeChipStyle(fill: tone.opacity(0.15), stroke: tone.opacity(0.30), text: tone)
    }

    static let neutral = SourceLayerBadgeChipStyle(
        fill: Color.TS.textMuted.opacity(0.12),
        stroke: Color.TS.border,
        text: Color.TS.textSecondary
    )
}

extension SourceLayerBadgeKind {
    /// The chip colors for the layer — the native port of the web `STYLE[key].tint`.
    var chipStyle: SourceLayerBadgeChipStyle {
        switch self {
        case .l1: .tinted(Color.TS.statusSuccess)
        case .l2: .tinted(Color.TS.statusInfo)
        case .stale: .tinted(Color.TS.statusWarning)
        case .log, .unknown: .neutral
        }
    }
}

// MARK: - Glyph chip (web `<span … font-mono uppercase …>`)

/// The tinted glyph chip — the native parity of the web badge span. Rendered in the monospaced label
/// token, uppercased and tracked like the web `font-mono uppercase tracking-wider`, with a minimum
/// width that follows the web `showLabel` prop (40pt for the spelled-out variant, 24pt for the bare
/// glyph). Non-interactive like the web span; the long-form explanation rides the pointer tooltip
/// (web `title`) and the chip is one VoiceOver element voicing the tooltip plus the offline note.
struct SourceLayerBadgeChip: View {
    let readout: SourceLayerBadgeReadout
    let showLabel: Bool
    let offline: Bool

    private var style: SourceLayerBadgeChipStyle {
        readout.layer.chipStyle
    }

    private var minWidth: CGFloat {
        showLabel ? 40 : 24
    }

    private var offlineNote: String? {
        offline ? SourceLayerBadgeStrings
            .string("sourceLayer.offlineA11y", "Offline — showing the last known value") : nil
    }

    var body: some View {
        Text(verbatim: readout.label)
            .font(Font.TS.label.monospaced())
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(style.text)
            .frame(minWidth: minWidth)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 2)
            .background(style.fill, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(style.stroke, lineWidth: 1)
            )
            .help(readout.tooltip)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: SourceLayerBadgeAccessibility.label(
                tooltip: readout.tooltip,
                offlineNote: offlineNote
            )))
    }
}

// MARK: - Offline marker (P4 connectivity decoration)

/// The offline marker shown beside the badge when the snapshot is offline — a small neutral dot that
/// signals the value is the last-known one. Decorative; the offline note is folded into the chip's
/// VoiceOver label, so the marker is hidden from VoiceOver to avoid a duplicate announcement.
struct SourceLayerBadgeOfflineMarker: View {
    var body: some View {
        Circle()
            .fill(Color.TS.textMuted)
            .frame(width: 6, height: 6)
            .accessibilityHidden(true)
    }
}

// MARK: - Resolved readout (web rendered badge)

/// The resolved readout row — the tinted glyph chip plus the offline marker when the snapshot is
/// offline, the native parity of the web rendered `<SourceLayerBadge>`.
struct SourceLayerBadgeReadyView: View {
    let readout: SourceLayerBadgeReadout
    let showLabel: Bool
    let offline: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            SourceLayerBadgeChip(readout: readout, showLabel: showLabel, offline: offline)
            if offline {
                SourceLayerBadgeOfflineMarker()
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading (feed resolving → neutral skeleton chip)

/// The neutral skeleton chip shown while the source feed resolves — a shimmer sized to the badge's
/// footprint (following the `showLabel` width) so the layout does not jump when the readout lands.
/// Shimmer respects Reduce Motion via the shared `TSSkeleton`.
struct SourceLayerBadgeLoadingChip: View {
    let showLabel: Bool

    var body: some View {
        TSSkeleton(width: showLabel ? 40 : 24, height: 18, cornerRadius: TSRadius.sm)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: SourceLayerBadgeStrings.string(
                "sourceLayer.loadingA11y",
                "Loading source layer"
            )))
    }
}

// MARK: - Unavailable (feed failed → neutral retry chip)

/// The neutral retry chip shown when the source feed fails — a `QueryError` peer scaled to the
/// badge's footprint. Re-requests the snapshot on tap.
struct SourceLayerBadgeUnavailableChip: View {
    let onRetry: () -> Void

    var body: some View {
        TSButton(variant: .secondary, size: .small, action: onRetry) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.caption2)
                Text(verbatim: SourceLayerBadgeStrings.string("sourceLayer.unavailable", "Source unavailable"))
                    .font(Font.TS.caption)
            }
        }
        .accessibilityLabel(Text(verbatim: SourceLayerBadgeStrings.string(
            "sourceLayer.unavailableA11y",
            "Source layer unavailable — tap to retry"
        )))
    }
}
