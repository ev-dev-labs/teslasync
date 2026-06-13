//
//  MaskedValue.Views.swift
//  TeslaSync — P4 shared surface · 0220 · MaskedValue (Apple)
//
//  The presentational pieces of the click-to-reveal privacy primitive: the monospaced code slot (web
//  `<code className="font-mono text-sm">` — masked bullets in the secondary tone, cleartext in the accent
//  tone), the eye toggle (web ghost `<Button>` with the lucide `Eye` / `EyeOff`), the optional copy
//  button (web `<CopyButton iconOnly>` → the shared ``CopyButton`` surface), the em-dash empty slot (web
//  `raw.length === 0` → `<span>—</span>`), and the composable ``MaskedValueContainer`` (the web outer
//  `<span>` row). All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports.
//
//  Web-parity detail, reproduced faithfully:
//    • the code slot shows `{revealed ? raw : masked}`; revealed recolours to the accent tone (web
//      `text-cyan-300`, mapped to the theme-aware ``Color/TS/accent``) and masked stays in the secondary
//      tone (web `var(--text-secondary)` → ``Color/TS/textSecondary``).
//    • the toggle's label + glyph mirror the state (web `revealed ? <EyeOff/> : <Eye/>` +
//      `aria-label={toggleLabel}` + `aria-pressed={revealed}` → `.isSelected`).
//    • the copy button (web `copyable`) always copies the RAW value regardless of mask state, via the
//      shared ``CopyButton`` surface (the native peer of the web `<CopyButton text iconOnly ariaLabel>`).
//    • the empty branch shows the em-dash with the caller `aria-label` and NO toggle (web early return).
//    • the raw secret is NEVER spoken as the VoiceOver label — the semantic `ariaLabel` is, exactly as
//      the web `aria-label` (the cleartext is exposed only as the accessibility VALUE once revealed, so a
//      user who explicitly revealed can still hear it).
//

import SwiftUI

// MARK: - MaskedValueCodeText (web `<code>` slot)

/// The monospaced code slot — the native peer of the web `<code className="font-mono text-sm break-all">`.
/// Shows the masked bullets or the cleartext per `revealed`, recolouring from the secondary tone to the
/// accent tone on reveal (web `text-cyan-300`). Uses the relative `.callout` monospaced style so the
/// secret scales with Dynamic Type. The spoken label is the semantic `accessibilityLabel` (never the raw
/// secret); the cleartext is exposed only as the accessibility VALUE once revealed.
struct MaskedValueCodeText: View {
    let projection: MaskedValueProjection
    let revealed: Bool

    var body: some View {
        Text(verbatim: projection.displayText(revealed: revealed))
            .font(.system(.callout, design: .monospaced))
            .foregroundStyle(Self.tone(revealed: revealed))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel(Text(verbatim: projection.accessibilityLabel))
            .accessibilityValue(revealed ? Text(verbatim: projection.rawText) : Text(verbatim: ""))
    }

    /// The code-slot tone — the theme-aware token projection of the web hues: the accent tone when
    /// revealed (web `text-cyan-300`) and the secondary tone when masked (web `var(--text-secondary)`).
    static func tone(revealed: Bool) -> Color {
        revealed ? Color.TS.accent : Color.TS.textSecondary
    }
}

// MARK: - MaskedValueToggle (web ghost `<Button>` + `Eye` / `EyeOff`)

/// The reveal / hide toggle — the native peer of the web ghost `<Button>` carrying the lucide `Eye` /
/// `EyeOff`. The glyph + label mirror the current state (web `revealed ? <EyeOff/> : <Eye/>` +
/// `aria-label={toggleLabel}`), and the `.isSelected` trait is the native peer of the web
/// `aria-pressed={revealed}`. The glyph is decorative for VoiceOver — the label conveys the action.
struct MaskedValueToggle: View {
    let projection: MaskedValueProjection
    let revealed: Bool
    let onToggle: () -> Void

    var body: some View {
        TSButton(variant: .ghost, size: .small) {
            onToggle()
        } label: {
            Image(systemName: revealed ? "eye.slash" : "eye")
                .accessibilityHidden(true)
        }
        .accessibilityLabel(Text(verbatim: projection.toggleLabel(revealed: revealed)))
        .accessibilityAddTraits(revealed ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - MaskedValueEmptyView (web `raw.length === 0` early return)

/// The empty slot — the native peer of the web early return `<span aria-label><span>—</span></span>`. An
/// em-dash in the muted tone (web `var(--text-muted)`) carrying the caller `aria-label`, with NO toggle:
/// there is nothing to reveal, and a toggle would be misleading.
struct MaskedValueEmptyView: View {
    let glyph: String
    let accessibilityLabel: String

    var body: some View {
        Text(verbatim: glyph)
            .font(.system(.callout, design: .monospaced))
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - MaskedValueContainer (web outer `<span>` row)

/// The privacy-primitive row — the native peer of the web outer `<span className="inline-flex items-center
/// gap-1.5">`: the code slot, the eye toggle, and (when `copyable`) the shared ``CopyButton`` that always
/// copies the RAW value. Renders the em-dash empty slot instead when there is nothing to mask. A pure
/// function of its projection + the toggle closure, so it composes in every branch for preview / snapshot
/// / test. The copy button is keyed on the raw value so a changed secret rebuilds it with fresh copy text.
struct MaskedValueContainer: View {
    let projection: MaskedValueProjection
    let revealed: Bool
    let onToggle: () -> Void

    var body: some View {
        Group {
            if projection.isEmpty {
                MaskedValueEmptyView(
                    glyph: projection.emptyGlyph,
                    accessibilityLabel: projection.accessibilityLabel
                )
            } else {
                content
            }
        }
        .accessibilityIdentifier(MaskedValueSurface.slug)
    }

    private var content: some View {
        HStack(spacing: TSSpacing.sm) {
            MaskedValueCodeText(projection: projection, revealed: revealed)
            MaskedValueToggle(projection: projection, revealed: revealed, onToggle: onToggle)
            if projection.copyable {
                CopyButton(
                    text: projection.rawText,
                    iconOnly: true,
                    ariaLabel: projection.copyLabel
                )
                .id(projection.rawText)
            }
        }
    }
}
