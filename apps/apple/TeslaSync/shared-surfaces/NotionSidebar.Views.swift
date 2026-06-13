//
//  NotionSidebar.Views.swift
//  TeslaSync — P4 shared surface · 0175 · NotionSidebar (Apple)
//
//  The presentational pieces of the sidebar — the native parity of the web `<NotionRow>`,
//  `<NotionSectionRow>`, `<GroupLabel>`, `<NotificationDot>`, `<CountChip>`, and the empty-filter block. They
//  render the resolved ``NotionSidebarPresentation`` value types and never recompute logic. All copy resolves
//  through P1/S10; all chrome is token-driven (P1/S9); transitions respect Reduce Motion; no raw hex, no
//  Tailwind ports.
//
//  Notion's quiet visual language (vs. Linear): the active row is JUST a subtle background fill — NO accent
//  bar, NO bold weight (Notion is the quietest possible). Group labels are sentence-case + muted (NOT
//  uppercase). A section is a single clickable line: a left caret that rotates, the section glyph (its first
//  item's icon), the title, and a count. Every row shows a pin (star) / unpin (close) affordance.
//

import SwiftUI

// MARK: - NotionSidebarNavRow (web `<NotionRow>`)

/// One nav row — the native parity of `<NotionRow>`. A muted SF Symbol glyph leads the truncating label, an
/// optional trailing badge sits at the end, and a trailing pin / unpin button follows. The active row is
/// marked ONLY by a quiet background fill (web `bg-white/[0.05]`) — no accent bar, no bold. The whole label
/// is a button that triggers `onSelect` (web `GuardedNavLink onClick`).
public struct NotionSidebarNavRow: View {
    private let row: NotionSidebarRow
    private let onSelect: () -> Void
    private let onPinToggle: () -> Void

    public init(row: NotionSidebarRow, onSelect: @escaping () -> Void, onPinToggle: @escaping () -> Void) {
        self.row = row
        self.onSelect = onSelect
        self.onPinToggle = onPinToggle
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            navButton
            pinButton
        }
    }

    /// The tappable label — glyph + truncating title + trailing badge (web `GuardedNavLink`).
    private var navButton: some View {
        Button(action: onSelect) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: row.systemImage)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(row.isActive ? Color.TS.textPrimary : Color.TS.textMuted)
                    .frame(width: 16)
                    .accessibilityHidden(true)
                Text(verbatim: row.title)
                    .font(Font.TS.body)
                    .foregroundStyle(row.isActive ? Color.TS.textPrimary : Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                NotionSidebarTrailingBadge(trailing: row.trailing)
            }
            .padding(.vertical, TSSpacing.xs)
            .padding(.horizontal, TSSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowBackground)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: row.title))
        .accessibilityAddTraits(row.isActive ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier(row.dataTour ?? "notion-sidebar-row-\(row.path)")
    }

    /// The quiet active-row fill — web `bg-white/[0.05]`, token-driven so light theme stays correct. No
    /// accent bar, no weight change: Notion marks the active page with this fill alone.
    private var rowBackground: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.textPrimary.opacity(row.isActive ? 0.05 : 0))
    }

    /// The pin / unpin action — web `pinAction` star (pin) / close (unpin). Notion shows one on every row.
    @ViewBuilder
    private var pinButton: some View {
        switch row.pinAffordance {
        case let .pin(label):
            pinActionButton(systemImage: "star", label: label)
        case let .unpin(label):
            pinActionButton(systemImage: "xmark", label: label)
        }
    }

    private func pinActionButton(systemImage: String, label: String) -> some View {
        Button(action: onPinToggle) {
            Image(systemName: systemImage)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - NotionSidebarTrailingBadge (web `<NotificationDot>` / `<CountChip>`)

/// The trailing badge — the native parity of the web `trailingFor` output. The notification dot is
/// decorative (web `aria-hidden`); the count chip carries its localized accessibility label (web `<CountChip
/// aria-label>`).
public struct NotionSidebarTrailingBadge: View {
    private let trailing: NotionSidebarTrailing

    public init(trailing: NotionSidebarTrailing) {
        self.trailing = trailing
    }

    public var body: some View {
        switch trailing {
        case .none:
            EmptyView()
        case .notificationDot:
            Circle()
                .fill(Color.TS.accent)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
        case let .count(text, label):
            Text(verbatim: text)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.xs)
                .frame(minWidth: 18, minHeight: 16)
                .background(
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .fill(Color.TS.textPrimary.opacity(0.05))
                )
                .accessibilityLabel(Text(verbatim: label))
        }
    }
}

// MARK: - NotionSidebarSectionRow (web `<NotionSectionRow>`)

/// A collapsible section row — the native parity of `<NotionSectionRow>`. Unlike Linear's uppercase header,
/// Notion renders the whole section as one quiet clickable line: a left caret that rotates open (web
/// `Icons.next` rotated 90°), the section glyph (its first item's icon), the sentence-case title, and the
/// filtered row count. The whole line is a toggle button labelled with the title for VoiceOver.
public struct NotionSidebarSectionRow: View {
    private let title: String
    private let glyphSystemImage: String
    private let rowCount: Int
    private let isExpanded: Bool
    private let onToggle: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(
        title: String,
        glyphSystemImage: String,
        count: Int,
        isExpanded: Bool,
        onToggle: @escaping () -> Void
    ) {
        self.title = title
        self.glyphSystemImage = glyphSystemImage
        rowCount = count
        self.isExpanded = isExpanded
        self.onToggle = onToggle
    }

    public var body: some View {
        Button(action: onToggle) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "chevron.right")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: isExpanded)
                    .frame(width: 12)
                    .accessibilityHidden(true)
                Image(systemName: glyphSystemImage)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(width: 16)
                    .accessibilityHidden(true)
                Text(verbatim: title)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if rowCount > 0 {
                    Text(verbatim: String(rowCount))
                        .font(Font.TS.caption)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityValue(Text(verbatim: String(rowCount)))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - NotionSidebarGroupLabel (web `<GroupLabel>`)

/// A group label — the native parity of the web `<GroupLabel>` (used for "Favorites" and "Pages"). Notion
/// renders these sentence-case + muted (NOT uppercase, never shouting), a small quiet caption above each
/// group.
public struct NotionSidebarGroupLabel: View {
    private let label: String

    public init(label: String) {
        self.label = label
    }

    public var body: some View {
        Text(verbatim: label)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.top, TSSpacing.sm)
            .padding(.bottom, TSSpacing.xs)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - NotionSidebarEmptyFilter (web "No matches." block)

/// The empty-filter branch — web `filterTokens.length > 0 && expandedSections.length === 0`. A centered "No
/// matches." message plus a "Clear filter" button.
public struct NotionSidebarEmptyFilter: View {
    private let message: String
    private let clearLabel: String
    private let onClear: () -> Void

    public init(message: String, clearLabel: String, onClear: @escaping () -> Void) {
        self.message = message
        self.clearLabel = clearLabel
        self.onClear = onClear
    }

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
            Button(action: onClear) {
                Text(verbatim: clearLabel)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: clearLabel))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .padding(.horizontal, TSSpacing.md)
    }
}

// MARK: - NotionSidebarEmptyState (no-data branch — never a blank box)

/// The no-data empty state — the web leaves a bare "Pages" label when there is nothing to show; this surface
/// renders a quiet friendly state instead (never a blank box, per the acceptance criteria).
public struct NotionSidebarEmptyState: View {
    private let message: String

    public init(message: String) {
        self.message = message
    }

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "doc.text")
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x2xl)
        .padding(.horizontal, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
