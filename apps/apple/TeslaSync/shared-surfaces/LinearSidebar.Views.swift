//
//  LinearSidebar.Views.swift
//  TeslaSync — P4 shared surface · 0174 · LinearSidebar (Apple)
//
//  The presentational pieces of the sidebar — the native parity of the web `<LinearNavLink>`,
//  `<LinearSectionHeader>`, `<NotificationDot>`, `<CountChip>`, the Favorites header, and the empty-filter
//  block. They render the resolved ``LinearSidebarPresentation`` value types and never recompute logic.
//  All copy resolves through P1/S10; all chrome is token-driven (P1/S9); transitions respect Reduce
//  Motion; no raw hex, no Tailwind ports. A DEBUG-only inspector stages every REAL branch (Favorites
//  present/absent, collapsed/expanded, active row, each trailing-badge variant, the filter, the
//  empty-filter and no-data branches) so the previews + the view-composition tests have a concrete
//  reference.
//

import SwiftUI

// MARK: - LinearSidebarNavRow (web `<LinearNavLink>`)

/// One nav row — the native parity of `<LinearNavLink>`. A leading 2pt accent bar marks the active page
/// (web `active && <span>`), a muted SF Symbol glyph leads the truncating label, an optional trailing
/// badge sits at the end, and a trailing pin / unpin button appears for rows that carry an affordance. The
/// whole label is a button that triggers `onSelect` (web `GuardedNavLink onClick`).
public struct LinearSidebarNavRow: View {
    private let row: LinearSidebarRow
    private let onSelect: () -> Void
    private let onPinToggle: () -> Void

    public init(row: LinearSidebarRow, onSelect: @escaping () -> Void, onPinToggle: @escaping () -> Void) {
        self.row = row
        self.onSelect = onSelect
        self.onPinToggle = onPinToggle
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            navButton
            pinButton
        }
        .overlay(alignment: .leading) { accentBar }
    }

    /// The 2pt left accent bar shown only on the active row — web `active && <span class="w-[2px]">`.
    @ViewBuilder
    private var accentBar: some View {
        if row.isActive {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(Color.TS.accent)
                .frame(width: 2, height: 20)
                .accessibilityHidden(true)
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
                    .fontWeight(row.isActive ? .medium : .regular)
                    .foregroundStyle(row.isActive ? Color.TS.textPrimary : Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                LinearSidebarTrailingBadge(trailing: row.trailing)
            }
            .padding(.vertical, TSSpacing.xs)
            .padding(.leading, TSSpacing.md)
            .padding(.trailing, TSSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowBackground)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: row.title))
        .accessibilityAddTraits(row.isActive ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier(row.dataTour ?? "linear-sidebar-row-\(row.path)")
    }

    /// The subtle active-row fill — web `bg-white/[0.04]`, token-driven so light theme stays correct.
    private var rowBackground: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.textPrimary.opacity(row.isActive ? 0.06 : 0))
    }

    /// The pin / unpin hover action — web `pinActionFor` star button / favorites unpin close button.
    @ViewBuilder
    private var pinButton: some View {
        switch row.pinAffordance {
        case .none:
            EmptyView()
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

// MARK: - LinearSidebarTrailingBadge (web `<NotificationDot>` / `<CountChip>`)

/// The trailing badge — the native parity of the web `trailingFor` output. The notification dot is
/// decorative (web `aria-hidden`); the count chip carries its localized accessibility label
/// (web `<CountChip aria-label>`).
public struct LinearSidebarTrailingBadge: View {
    private let trailing: LinearSidebarTrailing

    public init(trailing: LinearSidebarTrailing) {
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
                        .fill(Color.TS.textPrimary.opacity(0.06))
                )
                .accessibilityLabel(Text(verbatim: label))
        }
    }
}

// MARK: - LinearSidebarSectionHeader (web `<LinearSectionHeader>`)

/// A collapsible section header — the native parity of `<LinearSectionHeader>`. A rotating chevron (web
/// `Icons.next` rotated 90°), an uppercase tracked title, and the filtered row count. The whole header is
/// a toggle button labelled with the (original-case) title for VoiceOver.
public struct LinearSidebarSectionHeader: View {
    private let title: String
    private let rowCount: Int
    private let isExpanded: Bool
    private let onToggle: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(title: String, count: Int, isExpanded: Bool, onToggle: @escaping () -> Void) {
        self.title = title
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
                    .accessibilityHidden(true)
                Text(verbatim: title)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.textMuted)
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

// MARK: - LinearSidebarFavoritesHeader (web pinned group label)

/// The non-interactive Favorites group label — web pinned header (star glyph + "Favorites"). Always shown
/// while ≥ 1 item is pinned; it never collapses.
public struct LinearSidebarFavoritesHeader: View {
    private let label: String

    public init(label: String) {
        self.label = label
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "star")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - LinearSidebarEmptyFilter (web "No matches." block)

/// The empty-filter branch — web `filterTokens.length > 0 && expandedSections.length === 0`. A centered
/// "No matches." message plus a "Clear filter" button.
public struct LinearSidebarEmptyFilter: View {
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

// MARK: - LinearSidebarEmptyState (no-data branch — never a blank box)

/// The no-data empty state — the web leaves an empty `<nav>` when there is nothing to show; this surface
/// renders a quiet friendly state instead (never a blank box, per the acceptance criteria).
public struct LinearSidebarEmptyState: View {
    private let message: String

    public init(message: String) {
        self.message = message
    }

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "sidebar.left")
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
