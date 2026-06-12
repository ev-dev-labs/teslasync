//
//  Accordion.Views.swift
//  TeslaSync — P4 shared surface · 0203 · Accordion (Apple)
//
//  The presentational pieces of the collapsible section — the native peers of the web elements: the header
//  button (web `<button>` — the optional icon, the title, the optional badge + headerExtra, and the
//  rotating chevron), the animated body region (web `<motion.div>` with the top border), the entrance /
//  exit animation builder that honors Reduce Motion (web framer `height`/`opacity` transition), and the
//  friendly empty-body leaf (the native "never a blank box" peer of an expanded section with no children).
//  All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports. The chevron is hidden from VoiceOver;
//  the header carries an explicit label + expanded/collapsed value + expand/collapse hint.
//

import SwiftUI

// MARK: - Toggle animation (web framer `height`/`opacity` transition + chevron `duration-normal`)

/// Builds the SwiftUI disclosure animation — the native boundary that turns the web framer transition
/// (`{ height: 0 ↔ auto, opacity: 0 ↔ 1 }`, plus the chevron's `transition-transform duration-normal`)
/// into a single token-driven `Animation`. Returns `nil` under reduced motion so the section snaps open /
/// closed with no movement. The duration is the design system's `normal` motion token (P1/S9).
public enum AccordionMotion {
    /// The open / close animation, or `nil` when reduced motion is in effect.
    public static func toggle(reduce: Bool) -> Animation? {
        guard !reduce else { return nil }
        return .easeInOut(duration: TSMotion.normalDuration)
    }
}

// MARK: - Header (web `<button aria-expanded>`)

/// The header button — the native peer of the web `<button>`: an optional leading icon (web `icon`, muted),
/// the flex-grow title (web `flex-1 text-sm font-medium`), the optional badge + headerExtra regions (web
/// `badge` / `headerExtra`), and the trailing chevron that rotates `180°` when open (web `rotate-180`). The
/// whole row is one tap target with an explicit VoiceOver label / expanded value / hint; a subtle,
/// theme-adaptive hover tint mirrors the web `hover:bg-white/[0.02]`.
struct AccordionHeader<Icon: View, Badge: View, Extra: View>: View {
    let model: AccordionModel
    let icon: Icon
    let badge: Badge
    let headerExtra: Extra
    let onToggle: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: onToggle) {
            row
        }
        .buttonStyle(.plain)
        .background(Color.TS.textPrimary.opacity(isHovering ? 0.05 : 0))
        .contentShape(Rectangle())
        .onHover { isHovering = $0 }
        .accessibilityLabel(Text(verbatim: model.input.title))
        .accessibilityValue(Text(verbatim: AccordionStrings.stateValue(isOpen: model.projection.isOpen)))
        .accessibilityHint(Text(verbatim: AccordionStrings.toggleHint(isOpen: model.projection.isOpen)))
    }

    private var row: some View {
        HStack(spacing: TSSpacing.md) {
            if model.input.hasIcon {
                icon
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            Text(verbatim: model.input.title)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
            if model.input.hasBadge {
                badge
            }
            if model.input.hasHeaderExtra {
                headerExtra
            }
            chevron
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
    }

    private var chevron: some View {
        Image(systemName: "chevron.down")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Color.TS.textMuted)
            .rotationEffect(.degrees(model.projection.chevronRotationDegrees))
            .accessibilityHidden(true)
    }
}

// MARK: - Body (web `<motion.div>` with the top border)

/// The expanded body region — the native peer of the web `<motion.div>`: the caller's `children` with the
/// header padding, fronted by a hairline top border (web `border-t border-white/[0.04]`). The vertical
/// reveal is driven by the surface's animated layout (the native peer of the framer `height: 0 ↔ auto`);
/// this view owns the static chrome only.
struct AccordionBody<Content: View>: View {
    let content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, TSSpacing.lg)
            .padding(.vertical, TSSpacing.md)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(Color.TS.border)
                    .frame(height: 1)
            }
            .accessibilityElement(children: .contain)
    }
}

// MARK: - Empty-body leaf (native — never a blank box)

/// The friendly leaf a host passes when an expanded section has nothing to reveal — a labelled card
/// rather than a bare box (native HIG). The web simply renders empty children; the native peer states the
/// condition so the surface never collapses to an unexplained empty space. Token-driven (P1/S9); copy via
/// the P1/S10 facade; combined into a single VoiceOver element.
struct AccordionEmptyBody: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "tray")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: AccordionStrings.emptyTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: AccordionStrings.emptyMessage)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(AccordionStrings.emptyTitle). \(AccordionStrings.emptyMessage)")
        )
    }
}
