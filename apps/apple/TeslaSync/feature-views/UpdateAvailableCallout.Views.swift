//
//  UpdateAvailableCallout.Views.swift
//  TeslaSync — P4 feature view · 0259 · UpdateAvailableCallout (Apple)
//
//  The presentational core composed by the surface: the cyan-tinted glass callout card (web
//  `GlassPanel` with the `border-cyan-400/20 bg-cyan-500/[0.06]` classes), its accent
//  Sparkles tile (web `text-cyan-300` glyph), the heading + body + "last checked" text block
//  (web `<p>`s), the freshness chip (the P4 stale/offline leaf), and the "View notes"
//  external link (web `<a target="_blank">`). All consume the P1/S10 facade + the shared
//  P1/S9 tokens — no networking, no Tailwind ports, no raw hex. Entrance via the shared
//  `TSFadeIn` (web parent wraps the callout in `<FadeIn>`), honoring Reduce Motion.
//

import SwiftUI

// MARK: - Callout card (web `GlassPanel` cyan callout)

/// The presented callout: an accent Sparkles tile, the heading/body/last-checked text block,
/// and the trailing "View notes" link, on a cyan-tinted bordered glass surface.
struct UpdateAvailableCard: View {
    let content: UpdateAvailableContent
    let onRefresh: () -> Void

    var body: some View {
        TSFadeIn {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                UpdateAvailableIcon()
                textBlock
                Spacer(minLength: TSSpacing.sm)
                UpdateAvailableNotesLink(cta: content.cta, url: content.releaseNotesURL)
            }
            .padding(TSSpacing.lg)
            .background(
                Color.TS.accent.opacity(0.06),
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .tsGlassPanel()
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// Heading (web `text-sm font-semibold`) over the body paragraph + the muted "last
    /// checked" run (web `text-xs`) over the optional freshness chip (P4 leaf).
    private var textBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: content.heading.resolved(UAStrings.string))
                .font(Font.TS.body.weight(.semibold))
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            bodyParagraph
            if let note = UpdateAvailableCopy.freshnessNote(for: content.connection) {
                UpdateAvailableFreshnessChip(note: note, connection: content.connection)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The body sentence with the muted ` · Last checked …` run appended inline (web renders
    /// the last-checked `<span>` inside the same paragraph), composed via `Text` concatenation
    /// so the two foreground tints flow as one wrapping paragraph.
    private var bodyParagraph: some View {
        var paragraph = Text(verbatim: content.body.resolved(UAStrings.string))
            .foregroundColor(Color.TS.textSecondary)
        if let lastChecked = content.lastChecked {
            paragraph = paragraph
                + Text(verbatim: " · ").foregroundColor(Color.TS.textMuted)
                + Text(verbatim: lastChecked.resolved(UAStrings.string)).foregroundColor(Color.TS.textMuted)
        }
        return paragraph
            .font(Font.TS.caption)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// The combined VoiceOver label (heading, body, freshness note) — web reads the region.
    private var accessibilitySummary: String {
        let body = bodyAccessibilityText
        let note = UpdateAvailableCopy.freshnessNote(for: content.connection)?.resolved(UAStrings.string)
        return UpdateAvailableAccessibility.summary(
            heading: content.heading.resolved(UAStrings.string),
            body: body,
            freshnessNote: note
        )
    }

    /// The spoken body: the sentence plus the last-checked run when present.
    private var bodyAccessibilityText: String {
        let base = content.body.resolved(UAStrings.string)
        guard let lastChecked = content.lastChecked else { return base }
        return "\(base) \(lastChecked.resolved(UAStrings.string))"
    }
}

// MARK: - Accent icon (web `text-cyan-300 Sparkles`)

/// The leading accent Sparkles glyph (web `text-cyan-300`). Decorative — the heading conveys
/// the meaning to VoiceOver — so it is hidden from the accessibility tree (web `aria-hidden`).
struct UpdateAvailableIcon: View {
    var body: some View {
        Image(systemName: "sparkles")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(minWidth: 20, minHeight: 20)
            .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip (P4 leaf — stale / offline)

/// The freshness chip rendered on the presented callout when the result is stale or the app
/// is offline (web shows none — the timestamp is the only freshness cue). Stale is warning-
/// toned; offline is muted. Hidden from VoiceOver because the parent card folds the note
/// into its combined label.
struct UpdateAvailableFreshnessChip: View {
    let note: UAText
    let connection: UpdateConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: iconName)
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: note.resolved(UAStrings.string))
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
        .padding(.top, 2)
        .accessibilityHidden(true)
    }

    private var tone: Color {
        connection == .stale ? Color.TS.statusWarning : Color.TS.textMuted
    }

    private var iconName: String {
        connection == .stale ? "clock.arrow.circlepath" : "wifi.slash"
    }
}

// MARK: - View notes link (web `<a href target="_blank" rel="noopener">`)

/// The "View notes" call-to-action: a cyan pill opening the GitHub release-notes URL in the
/// browser (web external anchor). Carries the localized label + an external-link glyph, with
/// an explicit accessibility label + hint so VoiceOver announces the link and what it does.
struct UpdateAvailableNotesLink: View {
    let cta: UAText
    let url: URL?

    var body: some View {
        let label = cta.resolved(UAStrings.string)
        return Group {
            if let url {
                Link(destination: url) { pill(label) }
            } else {
                pill(label)
            }
        }
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityHint(Text(verbatim: UpdateAvailableCopy.viewNotesHint.resolved(UAStrings.string)))
        .accessibilityAddTraits(.isLink)
    }

    private func pill(_ label: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
            Image(systemName: "arrow.up.right")
                .font(.system(size: 11, weight: .semibold))
        }
        .foregroundStyle(Color.TS.accent)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(minHeight: 36)
        .background(Color.TS.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.accent.opacity(0.30), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }
}
