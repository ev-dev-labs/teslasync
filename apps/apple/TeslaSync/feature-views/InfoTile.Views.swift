//
//  InfoTile.Views.swift
//  TeslaSync — P4 feature view · 0280 · InfoTile (Apple)
//
//  The composed subviews for the InfoTile surface: the glass panel (web `GlassPanel`
//  with `p-4 overflow-hidden`), the muted icon + label row (web `flex items-center
//  gap-2 … text-xs`), the tinted value line (web `text-lg font-semibold truncate`), and
//  the optional sub line (web `text-[10px] … mt-0.5`). The whole tile is one VoiceOver
//  element whose label reads the label, value, and sub; the decorative icon is hidden.
//  Long label / value text truncates with a tail ellipsis (web `truncate`) while the
//  full value stays available to VoiceOver and the macOS hover tooltip (web `title`).
//

import SwiftUI

// MARK: - Panel (web `GlassPanel`)

/// The full tile: the glass panel wrapping the label row, value, and optional sub,
/// leading-aligned and filling its grid cell. Always renders the chrome (icon + label +
/// value) so the tile is never blank.
struct InfoTilePanel: View {
    let model: InfoTileModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: 0) {
                InfoTileLabelRow(systemImage: model.systemImage, label: model.label)
                    .padding(.bottom, 6)

                InfoTileValueText(value: model.displayValue, color: model.valueColor.color)

                if model.hasSub, let sub = model.sub {
                    InfoTileSubText(sub: sub)
                        .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .help(Text(verbatim: model.displayValue))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: model.accessibilityLabel))
        .accessibilityAddTraits(.isStaticText)
        .accessibilityIdentifier(model.accessibilityID)
    }
}

// MARK: - Label row (web muted `Icon` + `label`)

/// The leading icon and the muted, truncating label (web `flex items-center gap-2
/// text-[var(--text-muted)] text-xs`). The icon is decorative and hidden from VoiceOver.
struct InfoTileLabelRow: View {
    let systemImage: String
    let label: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .regular))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .foregroundStyle(Color.TS.textMuted)
    }
}

// MARK: - Value (web `text-lg font-semibold truncate`)

/// The value line: the section type role (18pt semibold, matching web `text-lg
/// font-semibold`), tinted by the semantic value color, truncating with a tail
/// ellipsis. The full value is still read by VoiceOver via the panel's combined label.
struct InfoTileValueText: View {
    let value: String
    let color: Color

    var body: some View {
        Text(verbatim: value)
            .font(Font.TS.section)
            .foregroundStyle(color)
            .lineLimit(1)
            .truncationMode(.tail)
    }
}

// MARK: - Sub (web `text-[10px] text-[var(--text-muted)]`)

/// The optional sub line under the value (web `text-[10px]`). Rendered verbatim from
/// the (already localized) parent-supplied string.
struct InfoTileSubText: View {
    let sub: String

    var body: some View {
        Text(verbatim: sub)
            .font(.system(size: 10, weight: .regular))
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(2)
    }
}
