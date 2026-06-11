//
//  Range.Views.swift
//  TeslaSync — P4 shared surface · 0087 · Range (Apple)
//
//  The presentational subviews composed by `RangeReadout` + `RangeLabel`, reproducing the web
//  `components/data-display/format/Range.tsx` output: the value branch (`<span>{formatDistance(...)}
//  </span>`), the empty branch (`<span>—</span>`), and the companion label (`useRangeLabel`). All copy
//  arrives pre-resolved through the projection (P1/S10). Colour + font are intentionally inherited —
//  the web `<span>` carries none of its own, so callers tint + size the text at the use-site with the
//  P1/S9 tokens (matching the `Distance` peer). No networking lives here.
//

import SwiftUI

// MARK: - Value branch (web `<span>{formatDistance(meters, {precision})}</span>`)

/// The formatted preferred range — the displayed figure with its unit and a self-describing VoiceOver
/// label. The figure is exposed as a single accessibility element so VoiceOver reads "320 km" as one
/// phrase.
struct RangeValueView: View {
    let value: RangeResolvedValue

    var body: some View {
        Text(verbatim: value.text)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: value.accessibilityLabel))
    }
}

// MARK: - Empty branch (web `<span>—</span>`)

/// The empty sentinel — the em-dash the web renders verbatim (or the user's `emptyDisplay` override),
/// with a localized VoiceOver label so assistive tech announces "No range data" rather than a bare "—".
struct RangeEmptyView: View {
    let empty: RangeResolvedEmpty

    var body: some View {
        Text(verbatim: empty.text)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: empty.accessibilityLabel))
    }
}

// MARK: - Companion label (web `useRangeLabel`)

/// The localized rated/ideal label — the rendered form of the `useRangeLabel` string. Self-describing,
/// so its visible text doubles as the VoiceOver label.
struct RangeLabelView: View {
    let label: String

    var body: some View {
        Text(verbatim: label)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: label))
    }
}
