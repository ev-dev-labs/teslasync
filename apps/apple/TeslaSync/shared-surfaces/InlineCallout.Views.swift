//
//  InlineCallout.Views.swift
//  TeslaSync — P4 shared surface · 0124 · InlineCallout (Apple)
//
//  The presentational pieces of the contextual callout: the variant → design-token projections and the
//  composable ``InlineCalloutContainer`` (the native peer of the web `<InlineCallout>` outer element —
//  the tinted, ringed inline row with a leading icon, the body content slot, and an optional trailing
//  action affordance, rendered as a status row, a link, or a button). All chrome is token-driven
//  (P1/S9); no raw hex, no Tailwind ports. Decorative glyphs are hidden from VoiceOver; the whole row is
//  spoken as one element with the resolved label.
//
//  Web-parity detail, reproduced exactly:
//    • status — `<div role="status">`: the row, non-interactive, spoken as one status element.
//    • link   — `<a href>`: the row wrapped in a `Link`, opening the URL (the OS adds the link trait).
//    • button — `<button onClick>`: the row wrapped in a plain `Button`, invoking the host handler.
//    • body colour — info/success use the secondary text token (web `--text-secondary`); warning/danger
//                    use the variant tint (web `amber-200/85` / `rose-200/85`).
//    • icon + trailing label/chevron — the variant tint (web `text-{c}-300`); both decorative.
//

import SwiftUI

// MARK: - InlineCalloutVariant → design tokens (web `VARIANT_STYLES`)

extension InlineCalloutVariant {
    /// The shared semantic tone — reused from the design system so the callout, badges, and banners
    /// agree on one info/success/warning/danger colour source (DRY).
    var tone: TSTone {
        switch self {
        case .info: .info
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        }
    }

    /// The variant tint — the theme-aware projection of the web `iconText` colour (`text-{c}-300`).
    /// Drives the tinted background, the ring, the leading icon, and the trailing affordance.
    var tint: Color {
        tone.color
    }

    /// The body-text colour — the theme-aware projection of the web `text` colour: info/success use the
    /// secondary token (web `--text-secondary`); warning/danger use the variant tint (web `amber-200/85`
    /// / `rose-200/85`) so the higher-attention tiers read louder, exactly as the web does.
    var bodyColor: Color {
        switch self {
        case .info, .success: Color.TS.textSecondary
        case .warning, .danger: tint
        }
    }
}

// MARK: - InlineCalloutContainer (web `<InlineCallout>` outer element)

/// The composable callout container — the native peer of the web `<InlineCallout>`: a tinted, ringed
/// inline row (leading icon + body content + optional trailing action affordance) rendered into a
/// status row, a link, or a button per the resolved ``InlineCalloutInteraction``. Generic over its
/// body content so a host can pass rich children (web `children: ReactNode`); the ``InlineCallout``
/// surface composes it with a `Text`. A pure function of its inputs — no networking, no derivation — so
/// it composes in every branch for snapshot / preview / test.
public struct InlineCalloutContainer<Content: View>: View {
    private let variant: InlineCalloutVariant
    private let iconSystemName: String?
    private let trailingLabel: String?
    private let interaction: InlineCalloutInteraction
    private let accessibilityLabel: String
    private let onActivate: (@MainActor () -> Void)?
    private let content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    @State private var hovering = false

    public init(
        variant: InlineCalloutVariant,
        iconSystemName: String?,
        trailingLabel: String?,
        interaction: InlineCalloutInteraction,
        accessibilityLabel: String,
        onActivate: (@MainActor () -> Void)? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.variant = variant
        self.iconSystemName = iconSystemName
        self.trailingLabel = trailingLabel
        self.interaction = interaction
        self.accessibilityLabel = accessibilityLabel
        self.onActivate = onActivate
        self.content = content()
    }

    public var body: some View {
        wrapper
            .accessibilityLabel(Text(verbatim: accessibilityLabel))
            .accessibilityAddTraits(extraTraits)
    }

    /// Selects the web wrapper: a non-interactive status row, a `Link` (web `<a href>`), or a plain
    /// `Button` (web `<button onClick>`). The `Link` / `Button` are leaf accessibility elements, so the
    /// composed label set above replaces their child-derived label.
    @ViewBuilder
    private var wrapper: some View {
        switch interaction {
        case .status:
            row.accessibilityElement(children: .ignore)
        case let .link(url):
            Button { openURL(url) } label: { row }
                .buttonStyle(.plain)
        case .button:
            Button { onActivate?() } label: { row }
                .buttonStyle(.plain)
        }
    }

    /// The link wrapper carries the link trait on top of the implicit button trait so VoiceOver
    /// announces it as a link (web `<a>`); status / button need no extra trait.
    private var extraTraits: AccessibilityTraits {
        if case .link = interaction {
            return .isLink
        }
        return []
    }

    /// The tinted, ringed inline row — the web outer element's chrome + content composition.
    private var row: some View {
        HStack(spacing: TSSpacing.sm) {
            if let iconSystemName {
                Image(systemName: iconSystemName)
                    .font(.system(size: 14))
                    .foregroundStyle(variant.tint)
                    .accessibilityHidden(true)
            }
            content
                .font(Font.TS.caption)
                .foregroundStyle(variant.bodyColor)
                .frame(maxWidth: .infinity, alignment: .leading)
                .multilineTextAlignment(.leading)
            if let trailingLabel {
                trailing(trailingLabel)
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(background, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(variant.tint.opacity(0.25), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: hovering)
        .onHover { hovering = $0 }
    }

    /// The trailing action affordance — the label + chevron (web `action.label` + `<ChevronRight>`).
    /// Decorative for VoiceOver (the label folds into the spoken element).
    private func trailing(_ label: String) -> some View {
        HStack(spacing: 2) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .semibold))
        }
        .foregroundStyle(variant.tint)
        .accessibilityHidden(true)
    }

    /// The tinted background — web `bg-{c}/5`, brightened slightly on pointer hover for the interactive
    /// wrappers (web `hover:bg-white/[0.03]`).
    private var background: Color {
        let bump = (hovering && interaction.isInteractive) ? 0.04 : 0.0
        return variant.tint.opacity(0.08 + bump)
    }
}
