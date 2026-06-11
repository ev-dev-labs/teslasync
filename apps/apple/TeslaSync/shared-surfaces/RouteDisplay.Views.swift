//
//  RouteDisplay.Views.swift
//  TeslaSync — P4 shared surface · 0101 · RouteDisplay (Apple)
//
//  The presentational subviews composed by `RouteDisplay`: the leading map pin (the native parity
//  of the web lucide `MapPin`, dimmed and decorative) and the body text that renders the projected
//  `RouteDisplayContent`. Both consume the shared P1/S9 tokens — no Tailwind ports, no raw hex. The
//  body is built from concatenated `Text` so the whole line truncates as one unit like the web
//  `truncate`, with the round-trip suffix and the no-location line dimmed to mirror `opacity-60`.
//

import SwiftUI

// MARK: - Leading map pin (web lucide `MapPin`, `aria-hidden`)

/// The small, dimmed, decorative map pin shown ahead of the line — the native parity of the web
/// lucide `MapPin` at `h-2.5 w-2.5 opacity-60`. Hidden from VoiceOver (web `aria-hidden`); the
/// route text carries the spoken content.
struct RouteDisplayPinIcon: View {
    var body: some View {
        Image(systemName: "mappin")
            .font(.system(size: 10))
            .foregroundStyle(Color.TS.textSecondary.opacity(0.6))
            .accessibilityHidden(true)
    }
}

// MARK: - Body text (the four web render branches)

/// Renders the resolved `RouteDisplayContent` as a single, truncating line. Each branch mirrors the
/// web component body: the no-location and round-trip-suffix runs are dimmed to `opacity-60`, while
/// the primary endpoint text uses the inherited secondary-text colour.
struct RouteDisplayBodyText: View {
    let content: RouteDisplayContent

    private var dimmed: Color {
        Color.TS.textSecondary.opacity(0.6)
    }

    var body: some View {
        switch content {
        case let .noLocation(text):
            Text(verbatim: text)
                .foregroundStyle(dimmed)
        case let .single(start):
            Text(verbatim: start)
        case let .roundTrip(start, phrase):
            Text(verbatim: start)
                + Text(verbatim: " ↻ \(phrase)").foregroundStyle(dimmed)
        case let .fromTo(start, end):
            Text(verbatim: "\(start) → \(end)")
        }
    }
}
