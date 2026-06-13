//
//  VisuallyHidden.Views.swift
//  TeslaSync — P4 shared surface · 0003 · VisuallyHidden (Apple)
//
//  The presentational subviews composed by `VisuallyHidden`: the semantics token chips, the
//  mode card (the visible parity of one rendered `<VisuallyHidden>`), the two live-region cards
//  fed by the announcer, the real reveal-on-focus skip link (the native parity of the web
//  `focus:not-sr-only` behaviour), the element-kind row (the web `as` polymorphism), the recent
//  history, and the data body. All consume the P1/S10 facade and the shared P1/S9 tokens /
//  components — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Token chip (one decorative ARIA / element token)

/// A compact chip pairing a localised caption with a verbatim ARIA / element token (e.g. "Role"
/// → `status`, "Element" → `span`). Decorative: the spoken meaning lives on the parent card's
/// combined accessibility label.
struct VisuallyHiddenTokenChip: View {
    let caption: String
    let token: String
    let tone: Color

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: caption)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: token)
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(tone)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
        .accessibilityHidden(true)
    }
}

// MARK: - Semantics chips (verbatim render of the web `liveProps`)

/// Renders a mode's resolved semantics as token chips — for a live region the `role` /
/// `aria-live` / `aria-atomic` triplet (web `liveProps`); for the hidden + focusable modes a
/// single descriptive chip. Decorative; the card carries the spoken summary.
struct VisuallyHiddenSemanticsChips: View {
    let semantics: VisuallyHiddenSemantics

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            if let role = semantics.role {
                VisuallyHiddenTokenChip(
                    caption: VisuallyHiddenStrings.string("vh.attr.role", "role"),
                    token: role,
                    tone: Color.TS.statusInfo
                )
            }
            if let live = semantics.ariaLive {
                VisuallyHiddenTokenChip(
                    caption: VisuallyHiddenStrings.string("vh.attr.live", "aria-live"),
                    token: live,
                    tone: Color.TS.statusInfo
                )
            }
            if let atomic = semantics.ariaAtomic {
                VisuallyHiddenTokenChip(
                    caption: VisuallyHiddenStrings.string("vh.attr.atomic", "aria-atomic"),
                    token: atomic,
                    tone: Color.TS.statusInfo
                )
            }
        }
    }
}

// MARK: - Element-kind row (web `as` polymorphism)

/// The supported element kinds the web `as` prop accepts (`span` default, `label`, `a`, `div`)
/// shown as monospaced tag chips — the surface's record that the hidden semantics are identical
/// across every tag, only the element changes.
struct VisuallyHiddenElementsRow: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: VisuallyHiddenStrings.string("vh.elements.title", "Renders as any element"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: TSSpacing.sm) {
                ForEach(VisuallyHiddenElement.allCases) { element in
                    Text(verbatim: element.tag)
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Color.TS.textSecondary)
                        .padding(.horizontal, TSSpacing.sm)
                        .padding(.vertical, TSSpacing.xs)
                        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm))
                        .overlay(
                            RoundedRectangle(cornerRadius: TSRadius.sm)
                                .strokeBorder(Color.TS.border, lineWidth: 1)
                        )
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: VisuallyHiddenStrings.string(
            "vh.elements.a11y", "Supported elements: span, label, anchor, div"
        )))
    }
}

// MARK: - Hidden mode card (the bare `sr-only` default)

/// The default hidden mode rendered visibly — a sample of content that is exposed to assistive
/// technology with no visual footprint. The whole card is one VoiceOver element naming the mode
/// then summarising what it does.
struct VisuallyHiddenHiddenCard: View {
    let sample: String

    private var summary: String {
        VisuallyHiddenStrings.string("vh.hidden.summary", "Exposed to assistive technology; no visual footprint")
    }

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                header
                Text(verbatim: sample)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: VisuallyHiddenAccessibility.modeLabel(
            modeName: VisuallyHiddenStrings.string("vh.hidden.title", "Hidden"), summary: summary
        )))
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "eye.slash.fill")
                .font(.system(size: 14))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: VisuallyHiddenStrings.string("vh.hidden.title", "Hidden"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: summary)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.trailing)
        }
    }
}

// MARK: - Live region card (visible parity of one `<VisuallyHidden liveRegion>`)

/// One live region rendered visibly — the polite or assertive region, with its name, the role
/// it plays, its computed semantics chips, and its current message (or an em-dash when it has
/// not been written to yet). The whole card is one VoiceOver element whose label reads the
/// region name then its message.
struct VisuallyHiddenRegionCard: View {
    let priority: VisuallyHiddenPriority
    let message: VisuallyHiddenMessage?

    private var semantics: VisuallyHiddenSemantics {
        .resolve(for: .liveRegion(priority))
    }

    private var tone: Color {
        priority.isInterrupting ? Color.TS.statusWarning : Color.TS.statusInfo
    }

    private var systemImage: String {
        priority.isInterrupting ? "exclamationmark.bubble.fill" : "speaker.wave.2.fill"
    }

    private var regionName: String {
        priority.isInterrupting
            ? VisuallyHiddenStrings.string("vh.region.assertive", "Assertive")
            : VisuallyHiddenStrings.string("vh.region.polite", "Polite")
    }

    private var emptyValue: String {
        VisuallyHiddenStrings.string("vh.region.emptyValue", "—")
    }

    private var accessibilityLabelText: String {
        VisuallyHiddenAccessibility.regionLabel(
            regionName: regionName,
            message: message?.text ?? "",
            emptyWord: VisuallyHiddenStrings.string("vh.region.emptyA11y", "no announcement yet")
        )
    }

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                header
                VisuallyHiddenSemanticsChips(semantics: semantics)
                Text(verbatim: message?.text ?? emptyValue)
                    .font(Font.TS.body)
                    .foregroundStyle(message == nil ? Color.TS.textMuted : Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 14))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            Text(verbatim: regionName)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
        }
    }
}

// MARK: - Focusable skip link (native parity of `focus:not-sr-only`)

/// The focusable mode rendered as a real control — visually hidden until it receives keyboard
/// focus, then revealed (the web "Skip to main content" pattern, `focus:not-sr-only`). The
/// reveal honours Reduce Motion. Always present in the accessibility tree so VoiceOver / Full
/// Keyboard Access can reach it.
struct VisuallyHiddenFocusableSkipLink: View {
    let content: String
    var onActivate: () -> Void = {}

    @FocusState private var focused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var hint: String {
        VisuallyHiddenStrings.string("vh.focusable.hint", "Focusable — reveals on keyboard focus")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "keyboard")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                Text(verbatim: VisuallyHiddenStrings.string("vh.focusable.title", "Focusable"))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: hint)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            skipLink
        }
    }

    private var skipLink: some View {
        Button(action: onActivate) {
            Text(verbatim: content)
                .font(Font.TS.body)
                .foregroundStyle(Color.white)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.sm)
                .background(Color.TS.accent, in: Capsule())
        }
        .buttonStyle(.plain)
        .focused($focused)
        .opacity(focused ? 1 : 0.18)
        .scaleEffect(focused ? 1 : 0.96, anchor: .leading)
        .overlay(
            Capsule().strokeBorder(Color.TS.accent.opacity(focused ? 0.9 : 0.3), lineWidth: focused ? 2 : 1)
        )
        .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.fastDuration), value: focused)
        .accessibilityLabel(Text(verbatim: content))
        .accessibilityHint(Text(verbatim: hint))
    }
}

// MARK: - Data body (mode catalog + recent history)

/// The data render — the mode catalog (the hidden default, the two live regions, the focusable
/// skip link, and the element-kind row) over the recent-announcement log, wrapped in the shared
/// fade-in. Renders for both the data and empty phases (the regions read as not-yet-written
/// when empty), so the surface never collapses to a blank box.
struct VisuallyHiddenDataView: View {
    let resolved: VisuallyHiddenResolved

    private var recent: [VisuallyHiddenMessage] {
        Array(resolved.recent.prefix(10))
    }

    private var sample: String {
        VisuallyHiddenStrings.string("vh.hidden.sample", "3 vehicles selected")
    }

    private var skipLabel: String {
        VisuallyHiddenStrings.string("vh.focusable.label", "Skip to main content")
    }

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                VisuallyHiddenHiddenCard(sample: sample)
                VisuallyHiddenRegionCard(priority: .polite, message: resolved.polite)
                VisuallyHiddenRegionCard(priority: .assertive, message: resolved.assertive)
                TSCard {
                    VisuallyHiddenFocusableSkipLink(content: skipLabel)
                }
                TSCard {
                    VisuallyHiddenElementsRow()
                }
                if !recent.isEmpty {
                    VisuallyHiddenHistorySection(messages: recent)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
