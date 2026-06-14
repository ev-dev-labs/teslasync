//
//  ReleaseNotes.Views.swift
//  TeslaSync — P4 shared surface · 0135 · ReleaseNotes (Apple)
//
//  The presentational pieces of the release-notes accordion — the native peers of the web elements: the
//  per-release glass card (web `<GlassPanel>` with the header `<button aria-expanded>` over the animated
//  body), the badge chip (web `<Badge variant>`), the change row (web `<li>` with the colored dot), the
//  empty-state leaves (the native "never a blank box" peers), and the toggle animation that honors Reduce
//  Motion (web framer height/opacity). All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports.
//  The chevron and the dots are hidden from VoiceOver; the header carries an explicit label + expanded /
//  collapsed value + show / hide hint, and each change row folds its category + text into one spoken phrase
//  so the dot's color-coded meaning is not lost.
//

import SwiftUI

// MARK: - Toggle animation (web framer height/opacity transition)

/// Builds the SwiftUI disclosure animation — the native boundary that turns the web framer transition
/// (`{ height, opacity }`) into a single token-driven `Animation`. Returns `nil` under reduced motion so
/// the card snaps open / closed with no movement. The duration is the design system's `normal` motion
/// token (P1/S9).
public enum ReleaseNotesMotion {
    /// The open / close animation, or `nil` when reduced motion is in effect.
    public static func toggle(reduce: Bool) -> Animation? {
        guard !reduce else { return nil }
        return .easeInOut(duration: TSMotion.normalDuration)
    }
}

// MARK: - Palette (web `BADGE_VARIANT` / `ICON_TINT` / `DOT_TINT`)

/// Maps the badge + change classifications to design tokens (P1/S9) — the native peer of the web Tailwind
/// tint maps. The web `text-emerald/cyan/amber/rose/purple` tints are resolved to the semantic status
/// tokens so light / dark / high-contrast all track the theme; no raw hex lives in the view.
public enum ReleaseNotesPalette {
    /// The accent for a badge — web `BADGE_VARIANT` (success / info / warning) + `ICON_TINT`.
    public static func badge(_ badge: ReleaseNotesBadge) -> Color {
        switch badge {
        case .latest: Color.TS.statusSuccess
        case .stable: Color.TS.statusInfo
        case .beta: Color.TS.statusWarning
        }
    }

    /// The dot tint for a change category — the web `DOT_TINT[item.type]`.
    public static func change(_ type: ReleaseNotesChangeType) -> Color {
        switch type {
        case .added: Color.TS.statusSuccess
        case .changed: Color.TS.statusInfo
        case .fixed: Color.TS.statusWarning
        case .removed: Color.TS.statusDanger
        case .deprecated: Color.TS.chartSeriesPower
        case .security: Color.TS.statusDanger
        }
    }
}

// MARK: - Badge chip (web `<Badge variant size="sm">`)

/// The release badge chip — the native peer of the web `<Badge variant={BADGE_VARIANT[badge]} size="sm">`:
/// a small capsule tinted by the badge accent, with the localized label resolved through the P1/S10 facade.
struct ReleaseBadgeChip: View {
    let badge: ReleaseNotesBadge

    var body: some View {
        let accent = ReleaseNotesPalette.badge(badge)
        Text(verbatim: ReleaseNotesStrings.badgeLabel(badge))
            .font(Font.TS.label)
            .foregroundStyle(accent)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(accent.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(accent.opacity(0.25), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Change row (web `<li>` with the colored dot)

/// One change line — the native peer of the web `<li>`: a category-tinted dot (web `DOT_TINT[type]`) and
/// the change text. The dot is decorative (hidden from VoiceOver); the row folds the spoken category label
/// and the text into one element so the color-coded meaning is announced.
struct ReleaseChangeRow: View {
    let row: ReleaseNotesChangeRow

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Circle()
                .fill(ReleaseNotesPalette.change(row.type))
                .frame(width: 6, height: 6)
                .padding(.top, 6)
                .accessibilityHidden(true)
            Text(verbatim: row.text)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(ReleaseNotesStrings.changeTypeLabel(row.type)): \(row.text)")
        )
    }
}

// MARK: - Per-release empty body (native — never a blank box)

/// The leaf shown when an open release lists no changes — a labelled line rather than a bare gap (native
/// HIG). The web simply renders an empty `<ul>`; the native peer states the condition.
struct ReleaseNotesEmptyChanges: View {
    var body: some View {
        Text(verbatim: ReleaseNotesStrings.emptyChangesTitle)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text(verbatim: ReleaseNotesStrings.emptyChangesTitle))
    }
}

// MARK: - Release card (web `<GlassPanel>` header button + animated body)

/// One release card — the native peer of a web `<GlassPanel>` entry: a full-width header button (the gift
/// glyph tinted by badge, `v{version}`, the badge chip, the date, and a chevron that rotates when open)
/// over an animated body (the "What's New" heading + the change list, or the empty-changes leaf). The card
/// chrome is token-driven (surface-glass fill, hairline border, rounded clip); the open / close honors
/// Reduce Motion.
struct ReleaseCard: View {
    let card: ReleaseNotesCardProjection
    let onToggle: () -> Void
    let reduceMotion: Bool

    @State private var isHovering = false

    var body: some View {
        VStack(spacing: 0) {
            header
            if card.showsBody {
                body(for: card)
                    .transition(.opacity)
            }
        }
        .background(Color.TS.surfaceGlass)
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .animation(ReleaseNotesMotion.toggle(reduce: reduceMotion), value: card.isExpanded)
    }

    private var header: some View {
        Button(action: onToggle) {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: "gift")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(ReleaseNotesPalette.badge(card.badge))
                    .accessibilityHidden(true)
                Text(verbatim: card.displayVersion)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                ReleaseBadgeChip(badge: card.badge)
                Text(verbatim: card.date)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                chevron
            }
            .padding(.horizontal, TSSpacing.lg)
            .padding(.vertical, TSSpacing.md)
        }
        .buttonStyle(.plain)
        .background(Color.TS.textPrimary.opacity(isHovering ? 0.04 : 0))
        .contentShape(Rectangle())
        .onHover { isHovering = $0 }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: headerLabel))
        .accessibilityValue(Text(verbatim: ReleaseNotesStrings.stateValue(isExpanded: card.isExpanded)))
        .accessibilityHint(Text(verbatim: ReleaseNotesStrings.toggleHint(isExpanded: card.isExpanded)))
        .accessibilityAddTraits(.isButton)
    }

    private var headerLabel: String {
        "\(card.displayVersion), \(ReleaseNotesStrings.badgeLabel(card.badge)), \(card.date)"
    }

    private var chevron: some View {
        Image(systemName: "chevron.down")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Color.TS.textMuted)
            .rotationEffect(.degrees(card.isExpanded ? 180 : 0))
            .accessibilityHidden(true)
    }

    private func body(for card: ReleaseNotesCardProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: ReleaseNotesStrings.heading)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
            if card.hasChanges {
                ForEach(card.changeRows) { row in
                    ReleaseChangeRow(row: row)
                }
            } else {
                ReleaseNotesEmptyChanges()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.lg)
        .padding(.top, TSSpacing.md)
        .padding(.bottom, TSSpacing.lg)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: 1)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Empty state (native — no releases to show)

/// The friendly empty state shown when there are no releases to list (web `releases.length === 0`) — a
/// labelled card rather than a bare box (native HIG). Token-driven (P1/S9); copy via the P1/S10 facade;
/// combined into a single VoiceOver element.
struct ReleaseNotesEmptyState: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "gift")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: ReleaseNotesStrings.emptyTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: ReleaseNotesStrings.emptyMessage)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x2xl)
        .padding(.horizontal, TSSpacing.lg)
        .background(Color.TS.surfaceGlass)
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(ReleaseNotesStrings.emptyTitle). \(ReleaseNotesStrings.emptyMessage)")
        )
    }
}
