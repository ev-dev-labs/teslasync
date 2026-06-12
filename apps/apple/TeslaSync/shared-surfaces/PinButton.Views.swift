//
//  PinButton.Views.swift
//  TeslaSync — P4 shared surface · 0222 · PinButton (Apple)
//
//  The presentational pieces of the shared pin affordance — the native peers of the web elements: the
//  glyph (web lucide `Pin` / `PinOff`) with its cold-load spinner stand-in, the optional inline label
//  (web `<span>`), and the gated freshness / error badge layered at the corner (the P4 states chrome the
//  web swallows). All chrome is token-driven (P1/S9): the pinned glyph is `Color.TS.statusWarning` (web
//  `text-amber-300`), the idle glyph is `Color.TS.textMuted` (web `text-[var(--text-muted)]`); no raw hex,
//  no Tailwind ports. Decorative glyphs are hidden from VoiceOver — the pin / unpin label + the composed
//  status value live on the button itself (see `PinButton.swift`).
//

import SwiftUI

// MARK: - Tone → token mapping (web amber / muted)

extension PinTone {
    /// The glyph color — `pinned` → amber (web `text-amber-300` → `Color.TS.statusWarning`), `idle` →
    /// muted (web `text-[var(--text-muted)]` → `Color.TS.textMuted`).
    var color: Color {
        switch self {
        case .idle: Color.TS.textMuted
        case .pinned: Color.TS.statusWarning
        }
    }

    /// The faint hover background tint behind the glyph (web `hover:bg-amber-500/10` /
    /// `hover:bg-[var(--surface-2)]`), pointer-only (macOS / iPadOS).
    var hoverTint: Color {
        switch self {
        case .idle: Color.TS.textPrimary
        case .pinned: Color.TS.statusWarning
        }
    }
}

extension PinStatusTone {
    /// The badge color — error → danger, stale → warning, offline → muted.
    var color: Color {
        switch self {
        case .error: Color.TS.statusDanger
        case .offline: Color.TS.textMuted
        case .stale: Color.TS.statusWarning
        }
    }
}

// MARK: - PinGlyphView (web lucide `Pin` / `PinOff`, or the cold-load spinner)

/// The glyph — the slashed/plain pushpin (web `Icon = isPinned ? PinOff : Pin`), or a button-sized
/// progress spinner during a cold first load (no cached set yet) so the surface is never a blank box.
/// Decorative: hidden from VoiceOver (the label lives on the button).
struct PinGlyphView: View {
    let projection: PinButtonProjection
    let size: PinButtonSize

    var body: some View {
        Group {
            if projection.isAwaitingFirstLoad {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: projection.presentation.symbolName)
                    .font(.system(size: size.glyphPointSize, weight: .semibold))
                    .foregroundStyle(projection.presentation.tone.color)
            }
        }
        .frame(width: size.glyphPointSize + TSSpacing.xs, height: size.glyphPointSize + TSSpacing.xs)
        .accessibilityHidden(true)
    }
}

// MARK: - PinInlineLabel (web `<span>` shown when `showLabel`)

/// The inline "Pin" / "Pinned" text shown beside the glyph when `showLabel` is set (web `<span
/// className="text-xs font-medium">`). Folds into the button's single VoiceOver element via the parent's
/// `.accessibilityElement(children: .combine)`, so it is not announced twice.
struct PinInlineLabel: View {
    let projection: PinButtonProjection
    let size: PinButtonSize

    var body: some View {
        Text(verbatim: PinButtonStrings.label(projection.presentation))
            .font(.system(size: size.labelPointSize, weight: .medium))
            .foregroundStyle(projection.presentation.tone.color)
            .lineLimit(1)
            .accessibilityHidden(true)
    }
}

// MARK: - PinStatusBadgeView (the P4 freshness / error corner indicator)

/// The small corner indicator shown over the button when the pin set is degraded (offline / error /
/// stale) — the native, button-scoped peer of the CookieConsentBanner status chip. Decorative: its
/// meaning is folded into the button's accessibility value, so it is hidden from VoiceOver here.
struct PinStatusBadgeView: View {
    let badge: PinStatusBadge

    var body: some View {
        Image(systemName: badge.symbolName)
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(badge.tone.color)
            .padding(1)
            .background(Color.TS.surface, in: Circle())
            .accessibilityHidden(true)
    }
}
