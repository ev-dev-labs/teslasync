//
//  HelpTooltip.Views.swift
//  TeslaSync — P4 shared surface · 0216 · HelpTooltip (Apple)
//
//  The presentational pieces of the help "?" tooltip — the native peers of the web elements: the default
//  glyph (web `<HelpCircle>`), the focusable trigger button (web the `<button aria-label>` wrapper), the
//  popover body (web the `<Tooltip>` content: the explanatory `<p>` + the optional "Learn more" `<a>`), and
//  the learn-more link itself. All chrome is token-driven (P1/S9): the body sits on the popover's system
//  material with semantic text colors; the trigger glyph is muted and brightens on hover (web `text-muted`
//  → `hover:text-secondary`); the external-link glyph is an SF Symbol. No raw hex, no Tailwind ports. The
//  trigger is one VoiceOver button named by the resolved accessible label (web `aria-label`); the decorative
//  glyphs are hidden from assistive technology (web `aria-hidden`); the learn-more link is a VoiceOver link
//  named by its label.
//

import SwiftUI

// MARK: - HelpTooltipDefaultIcon (web `<HelpCircle>`)

/// The default trigger glyph — the native peer of the web lucide `<HelpCircle>`: a `questionmark.circle` SF
/// Symbol sized from the surface's ``HelpTooltipSize`` (web `SIZE_CLASS`) and scaled with Dynamic Type via
/// `@ScaledMetric`. Decorative — the enclosing button carries the accessible name, so the glyph is hidden
/// from VoiceOver (web `aria-hidden`).
public struct HelpTooltipDefaultIcon: View {
    private let size: HelpTooltipSize
    @ScaledMetric private var glyphSide: CGFloat

    public init(size: HelpTooltipSize) {
        self.size = size
        _glyphSide = ScaledMetric(wrappedValue: size.baseGlyphSide, relativeTo: .body)
    }

    public var body: some View {
        Image(systemName: "questionmark.circle")
            .font(.system(size: glyphSide, weight: .regular))
            .accessibilityHidden(true)
    }
}

// MARK: - HelpTooltipIconButton (web `<button aria-label>`)

/// The focusable trigger — the native peer of the web `<button aria-label>{children ?? <HelpCircle>}`: it
/// wraps the supplied glyph in a plain button that toggles the tooltip (the native tap affordance), tints the
/// glyph muted and brightens it on hover (web `text-muted` → `hover:text-secondary`), and exposes the
/// resolved accessible name (web `aria-label`). Keyboard focus draws the system focus ring (web
/// `focus-visible:ring`).
struct HelpTooltipIconButton<Icon: View>: View {
    private let controller: HelpTooltipController
    private let icon: () -> Icon
    @State private var isHovering = false

    init(controller: HelpTooltipController, @ViewBuilder icon: @escaping () -> Icon) {
        self.controller = controller
        self.icon = icon
    }

    var body: some View {
        Button(action: controller.toggle) {
            icon()
                .foregroundStyle(isHovering ? Color.TS.textSecondary : Color.TS.textMuted)
                .padding(HelpTooltipLayout.triggerPadding)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .accessibilityLabel(Text(verbatim: controller.accessibilityLabel))
    }
}

// MARK: - HelpTooltipBody (web `<Tooltip>` content)

/// The popover body — the native peer of the web `<Tooltip content>`: the explanatory copy (web the `<p
/// text-primary>`) over the optional "Learn more" link, laid out leading-aligned and wrapped to a comfortable
/// multiline width (web `multiline`). Sits on the popover's system material; one VoiceOver container so the
/// copy and the (separately focusable) link are both reachable.
struct HelpTooltipBody: View {
    let content: HelpTooltipContent
    let learnMoreLabel: String

    var body: some View {
        VStack(alignment: .leading, spacing: HelpTooltipLayout.learnMoreTopSpacing) {
            Text(verbatim: content.text)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            if let learnMore = content.learnMore {
                HelpTooltipLearnMoreLink(label: learnMoreLabel, learnMore: learnMore)
            }
        }
        .padding(HelpTooltipLayout.popoverPadding)
        .frame(maxWidth: HelpTooltipLayout.bodyMaxWidth, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - HelpTooltipLearnMoreLink (web `<a target="_blank">`)

/// The "Learn more" affordance — the native peer of the web `<a href target="_blank">`: a browser link
/// named by its label with a trailing external-link glyph (web `<ExternalLink>`). A valid destination renders
/// an interactive `Link` (VoiceOver announces it as a link); a malformed URL degrades to the same label as
/// non-interactive text so the affordance still appears rather than crashing. The glyph is decorative (web
/// `aria-hidden`).
struct HelpTooltipLearnMoreLink: View {
    let label: String
    let learnMore: HelpTooltipLearnMore

    var body: some View {
        Group {
            if let url = learnMore.resolvedURL {
                Link(destination: url) { linkContent }
            } else {
                linkContent
            }
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textSecondary)
    }

    private var linkContent: some View {
        HStack(spacing: HelpTooltipLayout.learnMoreGap) {
            Text(verbatim: label)
            Image(systemName: "arrow.up.right")
                .font(.system(size: HelpTooltipLayout.externalGlyphSide, weight: .semibold))
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
    }
}
