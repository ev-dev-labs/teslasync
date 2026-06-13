//
//  ActionItem.Views.swift
//  TeslaSync — P4 shared surface · 0196 · ActionItem (Apple)
//
//  The presentational pieces of the single operator-task row: the severity → semantic-tone token
//  projection (the web `*-400` / `*-500` glyph / tint / ring hues) and the content view — the native peer
//  of the web composition (the leading severity glyph, the title + optional description, and the trailing
//  CTA affordance rendered as a link / button when the source supplies `to` / `onClick`). All chrome is
//  token-driven (P1/S9); the CTA's hover tint honours Reduce Motion; no raw hex, no Tailwind ports.
//
//  Web-parity detail, reproduced faithfully:
//    • the severity drives the glyph colour, the row's tinted background (web `bg-{c}-500/10`), and the
//      ring (web `ring-1 ring-{c}-400/20`), mapped to the shared ``TSTone`` tokens so it recolours across
//      light / dark / high-contrast where the web fixed hues did not.
//    • the title is the primary run (web `text-sm font-medium`, primary text); the description is the
//      optional sub-line (web `text-xs`, secondary text); the text column is the flexible region (web
//      `flex-1 min-w-0`), so a long title wraps before the CTA is squeezed.
//    • the CTA renders only when present (web `{cta && <ActionCTA/>}`); it is the severity-tinted label +
//      chevron (web `ActionCTA` `{label}<ChevronRight/>`), wrapped in a link / button per its kind.
//    • the leading glyph + the CTA chevron are decorative (web `aria-hidden`); the info group is spoken
//      as one element naming the severity, and the CTA is a separate focusable element.
//

import SwiftUI

// MARK: - ActionSeverity → semantic tone tokens (web glyph / tint / ring hues)

extension ActionSeverity {
    /// The semantic tone — the theme-aware token projection of the web severity hues (`info → info`,
    /// `warn → warning`, `error → danger`). Reuses the shared ``TSTone`` so the glyph, the tinted
    /// background, the ring, and the CTA accent agree on one colour source (DRY) and recolour across
    /// light / dark / high-contrast.
    var tone: TSTone {
        switch self {
        case .info: .info
        case .warn: .warning
        case .error: .danger
        }
    }

    /// The severity tint — drives the leading glyph, the ring, and the CTA accent (web `text-{c}-400`).
    var tint: Color {
        tone.color
    }
}

// MARK: - ActionItemContainer (web `<ActionItem>` outer element)

/// The operator-task row — the native peer of the web `<ActionItem>` body. A pure function of its
/// projection + the optional CTA handler: it renders the tinted, ringed surface with the leading severity
/// glyph, the title + optional description column, and the trailing CTA affordance. Generic-free + a pure
/// function of its inputs (no networking, no derivation), so it composes in every branch for snapshot /
/// preview / test.
public struct ActionItemContainer: View {
    private let projection: ActionItemProjection
    private let ctaAccessibilityHint: String?
    private let onActivateCTA: (@MainActor () -> Void)?

    public init(
        projection: ActionItemProjection,
        ctaAccessibilityHint: String?,
        onActivateCTA: (@MainActor () -> Void)? = nil
    ) {
        self.projection = projection
        self.ctaAccessibilityHint = ctaAccessibilityHint
        self.onActivateCTA = onActivateCTA
    }

    public var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            icon
            textColumn
            if let cta = projection.cta {
                ActionItemCTAButton(
                    cta: cta,
                    tint: projection.severity.tint,
                    accessibilityHint: ctaAccessibilityHint,
                    onActivate: onActivateCTA
                )
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            projection.severity.tint.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(projection.severity.tint.opacity(0.2), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    /// The leading severity glyph — the native peer of the web lucide icon (web `h-5 w-5 {text}`),
    /// top-aligned (web `mt-0.5`) and decorative for VoiceOver (web `aria-hidden`).
    private var icon: some View {
        Image(systemName: projection.iconSystemName)
            .font(.system(size: 18, weight: .regular))
            .foregroundStyle(projection.severity.tint)
            .accessibilityHidden(true)
    }

    /// The flexible text column — the title (web `text-sm font-medium`) over the optional description
    /// (web `text-xs`), spoken as a single VoiceOver element that names the severity (the projection's
    /// composed label) so the colour-encoded tier reaches non-sighted users.
    private var textColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: projection.title)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let description = projection.description {
                Text(verbatim: description)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: projection.accessibilityLabel))
    }
}

// MARK: - ActionItemCTAButton (web `ActionCTA`)

/// The trailing CTA affordance — the native peer of the web `ActionCTA`: a severity-tinted label +
/// chevron (web `{label}<ChevronRight/>`) wrapped in a tappable element that fires the embedder's handler
/// (the navigator for a route, the URL opener for an external link, or the in-app handler for an action).
/// VoiceOver announces it as a link for the link kinds (web `<Link>` / `<a>`) and a button for the action
/// kind (web `<button>`), with the navigation hint; the chevron is decorative.
struct ActionItemCTAButton: View {
    let cta: ActionItemCTAProjection
    let tint: Color
    let accessibilityHint: String?
    let onActivate: (@MainActor () -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovering = false

    var body: some View {
        Button { onActivate?() } label: { row }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: cta.label))
            .accessibilityHint(hintText)
            .accessibilityAddTraits(cta.accessibilityIsLink ? .isLink : [])
    }

    private var hintText: Text {
        accessibilityHint.map { Text(verbatim: $0) } ?? Text(verbatim: "")
    }

    /// The label + chevron row (web `ActionCTA` content), severity-tinted, with a faint hover fill (web
    /// `hover:bg-[var(--surface-2)]`) and a 36pt minimum tap target (web `min-h-[36px]`).
    private var row: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: cta.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .accessibilityHidden(true)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(minHeight: 36)
        .background(
            tint.opacity(isHovering ? 0.12 : 0),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: isHovering)
        .onHover { isHovering = $0 }
    }
}
