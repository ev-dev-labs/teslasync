//
//  Pressure.Views.swift
//  TeslaSync — P4 shared surface · 0086 · Pressure (Apple)
//
//  The presentational subviews composed by `Pressure`, reproducing the web
//  `components/data-display/format/Pressure.tsx` body: the value branch (`<span title={raw}>{display}
//  {unit}</span>`) and the empty branch (`<span>—</span>`). All copy arrives pre-resolved through the
//  projection (P1/S10). Colour + font are intentionally inherited — the web `<span>` carries none of
//  its own, so callers tint + size the figure at the use-site with the P1/S9 tokens (matching the
//  Distance peer + the `AnimatedNumber` atomic). The raw caller value is surfaced through SwiftUI
//  `.help` (the native parity of the web `title` tooltip). No networking lives here.
//

import SwiftUI

// MARK: - Value branch (web `<span title={raw}>{display} {unit}</span>`)

/// The formatted pressure — the displayed figure with its unit, the raw caller value as a hover/focus
/// tooltip (the web `title` parity), and a self-describing VoiceOver label. The figure is exposed as a
/// single accessibility element so VoiceOver reads "2.40 bar" as one phrase.
struct PressureValueView: View {
    let value: PressureResolvedValue

    var body: some View {
        Text(verbatim: value.text)
            .help(value.rawValueTitle)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: value.accessibilityLabel))
    }
}

// MARK: - Empty branch (web `<span>—</span>`)

/// The empty sentinel — the em-dash the web renders verbatim, with a localized VoiceOver label so
/// assistive tech announces "No pressure data" rather than a bare "—".
struct PressureEmptyView: View {
    let empty: PressureResolvedEmpty

    var body: some View {
        Text(verbatim: empty.text)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: empty.accessibilityLabel))
    }
}
