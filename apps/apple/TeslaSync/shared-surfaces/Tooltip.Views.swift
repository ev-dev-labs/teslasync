//
//  Tooltip.Views.swift
//  TeslaSync — P4 shared surface · 0231 · Tooltip (Apple)
//
//  The presentational pieces of the hover / focus tooltip — the native peers of the web elements: the placement
//  geometry (web `sideClasses`), the default text body (a string `content`), the floating inverted bubble (the
//  web `role="tooltip"` span: `rounded-lg bg-gray-900 text-gray-100 dark:bg-gray-100 dark:text-gray-900
//  shadow-lg`), and the outward-offset modifier that lifts the bubble clear of the trigger (the web `mb-2 /
//  mt-2 / mr-2 / ml-2` gap). All chrome is token-driven (P1/S9): the inverted surface maps to the design
//  tokens (background = ``Color/TS/textPrimary`` so the card is light in dark mode and dark in light mode;
//  foreground = ``Color/TS/bg`` so the text inverts with it — the exact high-contrast inversion the web
//  achieves with `dark:` variants); the body type is `text-xs font-medium`. No raw hex, no Tailwind ports.
//

import SwiftUI

// MARK: - TooltipSide geometry (web `sideClasses`)

extension TooltipSide {
    /// The overlay alignment anchoring the bubble to the trigger edge — the native peer of the web
    /// `sideClasses` position. `top` / `bottom` center horizontally (web `left-1/2 -translate-x-1/2`);
    /// `leading` / `trailing` center vertically (web `top-1/2 -translate-y-1/2`).
    var overlayAlignment: Alignment {
        switch self {
        case .top: .top
        case .bottom: .bottom
        case .leading: .leading
        case .trailing: .trailing
        }
    }

    /// The scale anchor the bubble grows from — the edge nearest the trigger, so the `scale-95 → scale-100`
    /// reveal expands outward from the trigger rather than from the bubble's own center.
    var scaleAnchor: UnitPoint {
        switch self {
        case .top: .bottom
        case .bottom: .top
        case .leading: .trailing
        case .trailing: .leading
        }
    }
}

// MARK: - TooltipText (web string `content`)

/// The default tooltip body — the native peer of a string `content`: `text-xs font-medium` copy that stays on
/// one line (web `whitespace-nowrap`) or wraps (web `multiline`). The bubble cascades the inverted foreground
/// color, so this view sets only the type, exactly as the web body inherits its color from the inverted
/// surface.
public struct TooltipText: View {
    let text: String
    let wrap: TooltipWrap

    public init(text: String, wrap: TooltipWrap) {
        self.text = text
        self.wrap = wrap
    }

    public var body: some View {
        Text(verbatim: text)
            .font(Font.TS.bodySm)
            .fontWeight(.medium)
            .lineLimit(wrap.isMultiline ? nil : 1)
            .fixedSize(horizontal: !wrap.isMultiline, vertical: true)
            .multilineTextAlignment(.leading)
    }
}

// MARK: - TooltipBubble (web `role="tooltip"` span)

/// The floating tooltip body — the native peer of the web `role="tooltip"` span. It hosts the content on the
/// inverted high-contrast surface (background = ``Color/TS/textPrimary``, foreground = ``Color/TS/bg`` — the
/// token inversion that reproduces `bg-gray-900 text-gray-100 dark:bg-gray-100 dark:text-gray-900`), rounds
/// to ``TooltipMetrics/cornerRadius`` (web `rounded-lg`), drops a `shadow-lg`, and — under increased contrast
/// — draws a hairline edge (the web `forced-colors:border`). It is non-interactive (web `pointer-events-none`)
/// and reveals with the `opacity-0 scale-95 → opacity-100 scale-100` transition, anchored to the trigger edge
/// and disabled under Reduce Motion (web `motion-reduce:transition-none`). When shown it exposes the localized
/// VoiceOver role (web `role="tooltip"`); the body copy itself is announced through the trigger's
/// `aria-describedby` peer (Tooltip.swift), so the bubble carries no duplicate value.
struct TooltipBubble<Content: View>: View {
    let side: TooltipSide
    let wrap: TooltipWrap
    let roleDescription: String
    let isVisible: Bool
    let reduceMotion: Bool
    @ViewBuilder var content: () -> Content

    @Environment(\.colorSchemeContrast) private var contrast

    private var isIncreasedContrast: Bool {
        contrast == .increased
    }

    var body: some View {
        content()
            .foregroundStyle(Color.TS.bg)
            .padding(.horizontal, TooltipMetrics.horizontalPadding)
            .padding(.vertical, TooltipMetrics.verticalPadding)
            .frame(
                maxWidth: wrap.isMultiline ? TooltipMetrics.multilineMaxWidth : nil,
                alignment: .leading
            )
            .background(
                RoundedRectangle(cornerRadius: TooltipMetrics.cornerRadius, style: .continuous)
                    .fill(Color.TS.textPrimary)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TooltipMetrics.cornerRadius, style: .continuous)
                    .strokeBorder(
                        Color.TS.bg.opacity(isIncreasedContrast ? 0.65 : 0),
                        lineWidth: isIncreasedContrast ? TooltipMetrics.increasedContrastHairline : 0
                    )
            )
            .shadow(
                color: .black.opacity(TooltipMetrics.shadowOpacity),
                radius: TooltipMetrics.shadowRadius,
                x: 0,
                y: TooltipMetrics.shadowYOffset
            )
            .opacity(isVisible ? 1 : 0)
            .scaleEffect(isVisible ? 1 : TooltipMetrics.hiddenScale, anchor: side.scaleAnchor)
            .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: isVisible)
            .allowsHitTesting(false)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: roleDescription))
            .accessibilityHidden(!isVisible)
    }
}

// MARK: - TooltipOutwardOffset (web `mb-2 / mt-2 / mr-2 / ml-2` gap)

/// Lifts the bubble clear of the trigger by ``TooltipMetrics/gap`` on the chosen side — the native peer of the
/// web `mb-2 / mt-2 / mr-2 / ml-2`. It overrides the overlay alignment guide so the bubble's near edge sits
/// `gap` points outside the trigger's matching edge, regardless of the bubble's measured size (no manual
/// geometry reads needed).
struct TooltipOutwardOffset: ViewModifier {
    let side: TooltipSide
    let gap: CGFloat

    func body(content: Content) -> some View {
        switch side {
        case .top:
            content.alignmentGuide(.top) { dimension in dimension[.bottom] + gap }
        case .bottom:
            content.alignmentGuide(.bottom) { dimension in dimension[.top] - gap }
        case .leading:
            content.alignmentGuide(.leading) { dimension in dimension[.trailing] + gap }
        case .trailing:
            content.alignmentGuide(.trailing) { dimension in dimension[.leading] - gap }
        }
    }
}
