//
//  Checkbox.Views.swift
//  TeslaSync — P4 shared surface · 0204 · Checkbox (Apple)
//
//  The presentational subviews composed by `Checkbox`, reproducing the web `components/ui/Checkbox.tsx`
//  output: the styled indicator box (the native peer of the web visually-hidden `<input>` + the layered
//  indicator `<span>` — the rounded box, the accent border + fill when checked / indeterminate, and the
//  check / minus glyph), and the optional trailing label (web `{label != null && <span>…</span>}`). The
//  whole row composes inside the surface's tap target. Copy arrives pre-resolved through the projection
//  (P1/S10); the accent, border, type, radius, and spacing come from the P1/S9 tokens — no raw hex, no
//  Tailwind ports. The glyph + box transitions honor Reduce Motion.
//

import SwiftUI

// MARK: - State transition (web `transition-colors`)

/// Builds the SwiftUI color / glyph transition — the native boundary that turns the web indicator's
/// `transition-colors` into a single token-driven `Animation`. Returns `nil` under reduced motion so
/// the box snaps between states with no movement. The duration is the design system's `fast` motion
/// token (P1/S9).
public enum CheckboxMotion {
    /// The checked / indeterminate transition, or `nil` when reduced motion is in effect.
    public static func state(reduce: Bool) -> Animation? {
        guard !reduce else { return nil }
        return .easeInOut(duration: TSMotion.fastDuration)
    }
}

// MARK: - Indicator (web visually-hidden input + layered indicator span)

/// The styled box — the native peer of the web indicator `<span>`. A rounded square that wears the
/// strong border + faint glass fill at rest (web `border-[var(--border-strong)] bg-white/[0.04]`) and
/// the accent border + accent/20 fill when checked / indeterminate (web `peer-checked` /
/// `peer-indeterminate`), with the check / minus glyph drawn in the accent (web `text-cyan-300`). The
/// box scales with the size variant's metrics. Hidden from VoiceOver — the surface carries the name +
/// checked value on the control itself.
struct CheckboxIndicator: View {
    let resolved: CheckboxResolved
    let reduceMotion: Bool

    private var metrics: CheckboxMetrics {
        resolved.size.metrics
    }

    private var radius: CGFloat {
        CGFloat(CheckboxMeta.cornerRadius)
    }

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(resolved.isActive ? Color.TS.accent.opacity(0.2) : Color.TS.surfaceGlass)
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(resolved.isActive ? Color.TS.accent : Color.TS.border, lineWidth: 1)
            )
            .overlay { glyph }
            .frame(width: CGFloat(metrics.boxSide), height: CGFloat(metrics.boxSide))
            .animation(CheckboxMotion.state(reduce: reduceMotion), value: resolved.isActive)
            .animation(CheckboxMotion.state(reduce: reduceMotion), value: resolved.glyph)
            .accessibilityHidden(true)
    }

    /// The glyph — a checkmark (web `<Check>`), a minus (web `<Minus>`, mixed state), or nothing (web
    /// transparent icon → empty box), drawn in the accent at the size variant's icon point size.
    @ViewBuilder private var glyph: some View {
        switch resolved.glyph {
        case .none:
            EmptyView()
        case .check:
            glyphImage("checkmark")
        case .minus:
            glyphImage("minus")
        }
    }

    private func glyphImage(_ systemName: String) -> some View {
        Image(systemName: systemName)
            .font(.system(size: CGFloat(metrics.iconPointSize), weight: .bold))
            .foregroundStyle(Color.TS.accent)
            .transition(.opacity)
    }
}

// MARK: - Label (web `{label != null && <span>…</span>}`)

/// The trailing label — the web `<span class="text-sm text-[var(--text-primary)]">`. Shown only when
/// the projection carries one. Hidden from VoiceOver because the control already carries the name, so
/// it is not announced twice.
struct CheckboxLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityHidden(true)
    }
}

// MARK: - Row (web `<label>` — indicator + optional label, one tap target)

/// The box + optional label laid out on one row — the native peer of the web `<label class="inline-flex
/// items-center gap-2">` wrapper. The whole row is the surface's tap target (the web label toggles the
/// box on click); the spacing is the P1/S9 `sm` token (web `gap-2`).
struct CheckboxRow: View {
    let resolved: CheckboxResolved
    let reduceMotion: Bool

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            CheckboxIndicator(resolved: resolved, reduceMotion: reduceMotion)
            if let labelText = resolved.labelText {
                CheckboxLabel(text: labelText)
            }
        }
        .contentShape(Rectangle())
    }
}
