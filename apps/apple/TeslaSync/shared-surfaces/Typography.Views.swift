//
//  Typography.Views.swift
//  TeslaSync — P4 shared surface · 0232 · Typography (Apple)
//
//  The presentational bridge for the typographic role system — the native boundary that turns the pure
//  ``TypographyStyle`` descriptor into SwiftUI primitives: the resolved Dynamic-Type `Font` (web `text-*` +
//  `font-*`), the theme-aware foreground `Color.TS.*` (web `text-[var(--text-*)]`), the letter spacing from
//  `TSTypeMetrics` (web `tracking-*`), the tabular figures (web `tabular-nums`), the uppercasing (web
//  `uppercase`), and the VoiceOver heading trait (the web semantic `<h1>`…`<h4>`). It also hosts the styled
//  text leaf and the friendly "never a blank box" empty leaf. All chrome is token-driven (P1/S9); no raw
//  hex, no fixed-point ramp, no Tailwind ports.
//

import SwiftUI

// MARK: - Resolved-descriptor → SwiftUI bridges

extension TypographyTextStyle {
    /// The SwiftUI semantic text style — scales with the user's preferred content size (Dynamic Type). A
    /// dictionary (not a `switch`) keeps the 11-way bridge declarative; completeness is asserted in tests.
    private static let swiftUIStyles: [TypographyTextStyle: Font.TextStyle] = [
        .caption2: .caption2,
        .caption: .caption,
        .footnote: .footnote,
        .subheadline: .subheadline,
        .callout: .callout,
        .body: .body,
        .headline: .headline,
        .title3: .title3,
        .title2: .title2,
        .title: .title,
        .largeTitle: .largeTitle
    ]

    var swiftUI: Font.TextStyle {
        Self.swiftUIStyles[self] ?? .body
    }
}

extension TypographyWeight {
    /// The SwiftUI font weight — the web `font-normal` / `font-medium` / `font-semibold` / `font-bold`.
    var swiftUI: Font.Weight {
        switch self {
        case .regular: .regular
        case .medium: .medium
        case .semibold: .semibold
        case .bold: .bold
        }
    }
}

extension TypographyDesign {
    /// The SwiftUI font design — the web `font-sans` / `font-mono`.
    var swiftUI: Font.Design {
        switch self {
        case .standard: .default
        case .monospaced: .monospaced
        }
    }
}

extension TypographyColorToken {
    /// The theme-aware foreground colour — the native port of the web `text-[var(--text-*)]` onto the P1/S9
    /// `Color.TS.*` tokens (which invert per light/dark/high-contrast), so no raw `text-white/N` shade is
    /// hardcoded. `subtle` / `disabled` dim a token via opacity (a dynamic modifier, not a fixed colour);
    /// `inverse` paints the background token for text sitting on an inverted surface; `danger` is the web
    /// `error` role's `text-rose-300`.
    var swiftUI: Color {
        switch self {
        case .primary: Color.TS.textPrimary
        case .secondary: Color.TS.textSecondary
        case .muted: Color.TS.textMuted
        case .subtle: Color.TS.textSecondary.opacity(0.8)
        case .disabled: Color.TS.textMuted.opacity(0.55)
        case .inverse: Color.TS.bg
        case .danger: Color.TS.statusDanger
        }
    }
}

extension TypographyTracking {
    /// The letter spacing in points — the native port of the web `tracking-*` utility onto the matching
    /// `TSTypeMetrics` tracking constant (P1/S9), so the spacing stays in sync with the design ramp.
    var points: CGFloat {
        switch self {
        case .display: TSTypeMetrics.displayTracking
        case .title: TSTypeMetrics.titleTracking
        case .section: TSTypeMetrics.sectionTracking
        case .panel: TSTypeMetrics.panelTracking
        case .body: TSTypeMetrics.bodyTracking
        case .bodySm: TSTypeMetrics.bodySmTracking
        case .caption: TSTypeMetrics.captionTracking
        case .label: TSTypeMetrics.labelTracking
        }
    }
}

extension TypographyStyle {
    /// The resolved Dynamic-Type font — the web `text-*` size + `font-*` weight + `font-mono` design.
    var font: Font {
        Font.system(textStyle.swiftUI, design: design.swiftUI, weight: weight.swiftUI)
    }
}

// MARK: - Style modifier (web composed `className`)

/// Applies a resolved ``TypographyStyle`` to any text view — the native peer of the web composed
/// `className`. Sets the Dynamic-Type font, the theme-aware colour, the letter spacing, the tabular figures
/// (web `tabular-nums`), the uppercasing (web `uppercase`), and the VoiceOver heading trait for the heading
/// roles. Order matters: `textCase` before `tracking` so the spacing applies to the cased glyphs.
struct TypographyStyleModifier: ViewModifier {
    let style: TypographyStyle

    func body(content: Content) -> some View {
        content
            .font(style.font)
            .foregroundStyle(style.color.swiftUI)
            .textCase(style.isUppercased ? .uppercase : nil)
            .tracking(style.tracking.points)
            .monospacedDigit(isOn: style.monospacedDigit)
            .accessibilityAddTraits(style.isAccessibilityHeader ? .isHeader : [])
    }
}

private extension View {
    /// Applies `.monospacedDigit()` only when `isOn` — keeps the conditional out of the modifier body so the
    /// view type stays stable (no `AnyView`).
    @ViewBuilder
    func monospacedDigit(isOn: Bool) -> some View {
        if isOn {
            monospacedDigit()
        } else {
            self
        }
    }
}

extension View {
    /// Applies a resolved typographic style — the native peer of binding a web `typography.role` className.
    func typographyStyle(_ style: TypographyStyle) -> some View {
        modifier(TypographyStyleModifier(style: style))
    }
}

// MARK: - Styled text leaf (web rendered `<Tag className>{children}</Tag>`)

/// The styled text leaf — the native parity of the web `<Tag className>{children}</Tag>`. Renders the
/// caller's already-localized text verbatim with the resolved style, or the friendly empty leaf when the
/// text is blank (web renders empty children; the native peer never shows a bare box).
struct TypographyStyledText: View {
    let content: TypographyContent

    var body: some View {
        if content.isBlank {
            TypographyEmptyLeaf()
        } else {
            Text(verbatim: content.text)
                .typographyStyle(content.style)
        }
    }
}

// MARK: - Empty leaf (native — never a blank box)

/// The friendly leaf shown when a host passes empty text — a labelled prompt rather than a bare box
/// (native HIG). The web simply renders empty children; the native peer states the condition so the surface
/// never collapses to an unexplained empty space. Token-driven (P1/S9); copy via the P1/S10 facade;
/// combined into a single VoiceOver element.
struct TypographyEmptyLeaf: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "text.alignleft")
                .font(.footnote)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: TypographyStrings.emptyTitle)
                    .font(Font.system(.footnote, weight: .medium))
                    .foregroundStyle(Color.TS.textSecondary)
                Text(verbatim: TypographyStrings.emptyMessage)
                    .font(.caption2)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(Color.TS.surfaceGlass)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(TypographyStrings.emptyTitle). \(TypographyStrings.emptyMessage)")
        )
    }
}
