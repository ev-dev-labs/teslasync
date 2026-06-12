//
//  Layout.Chrome.swift
//  TeslaSync — P4 shared surface · 0169 · Layout (Apple)
//
//  The sidebar chrome of the app shell — the native peers of the web sidebar header + grouped navigation: the
//  brand lockup with the quick theme switcher (web local `ThemeQuickSwitcher`) and the notification-bell
//  trigger (web `NotificationBellPopover` slot), the Pinned group (web pinned block + per-row unpin), the
//  Sections group with Expand-all / Collapse-all (web `NavSectionHeader` action), and the model-bound sidebar
//  body that composes the active card + groups. The theme picker / bell popover bodies are owned by their own
//  surfaces; the shell places their triggers. Token-driven; every control carries a VoiceOver label.
//

import SwiftUI

// MARK: - Quick theme switcher (web local `ThemeQuickSwitcher`)

/// The brand-row theme switcher — the SwiftUI parity of the web `ThemeQuickSwitcher`: a palette trigger
/// (`theme.openPicker`) that reveals a compact panel whose "Customize…" action (`theme.customize`) routes to
/// appearance settings. The theme picker body itself is the shared ThemePicker surface; here is its trigger.
struct LayoutThemeSwitcher: View {
    let onCustomize: () -> Void
    @State private var open = false

    var body: some View {
        VStack(alignment: .trailing, spacing: TSSpacing.xs) {
            Button { open.toggle() } label: {
                Image(systemName: "paintpalette")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: LayoutStrings.themeOpenPicker))
            .accessibilityAddTraits(open ? [.isButton, .isSelected] : .isButton)

            if open {
                Button { open = false; onCustomize() } label: {
                    Text(verbatim: LayoutStrings.themeCustomize)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: LayoutStrings.themeCustomize))
            }
        }
    }
}

// MARK: - Notification bell trigger (web `NotificationBellPopover` slot)

/// The header notification-bell trigger — the SwiftUI parity of the web `NotificationBellPopover` placement:
/// a bell with the unread-alert count chip, routing to the inbox via `onOpen`. The triage popover is owned by
/// its own surface.
struct LayoutBellTrigger: View {
    let unread: Int
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            Image(systemName: unread > 0 ? "bell.badge.fill" : "bell")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(unread > 0 ? Color.TS.accent : Color.TS.textSecondary)
                .frame(width: 32, height: 32)
                .overlay(alignment: .topTrailing) {
                    if unread > 0 {
                        LayoutNavBadgeChip(badge: LayoutNavBadge(
                            text: unread > 9 ? "9+" : String(unread),
                            tone: .danger
                        ))
                        .scaleEffect(0.7)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: LayoutStrings.notifications))
        .accessibilityValue(Text(verbatim: unread > 0 ? String(unread) : ""))
    }
}

// MARK: - Sidebar header (web sidebar logo row)

/// The sidebar header — the SwiftUI parity of the desktop sidebar logo row: the brand lockup, the quick theme
/// switcher, and the notification-bell trigger.
struct LayoutSidebarHeader: View {
    let unread: Int
    let onCustomizeTheme: () -> Void
    let onOpenNotifications: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSLogo(showsWordmark: true)
            Spacer(minLength: TSSpacing.sm)
            LayoutThemeSwitcher(onCustomize: onCustomizeTheme)
            LayoutBellTrigger(unread: unread, onOpen: onOpenNotifications)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.md)
        .overlay(alignment: .bottom) { Divider().overlay(Color.TS.border) }
    }
}

// MARK: - Pinned group (web pinned block)

/// The Pinned group — the SwiftUI parity of the web pinned block: a "Pinned" header and the pinned rows, each
/// with a trailing unpin button whose accessible name interpolates the page label (`nav.unpinPage`).
struct LayoutPinnedGroup: View {
    let items: [LayoutNavItem]
    let activePathname: String
    let onSelect: (String) -> Void
    let onUnpin: (String) -> Void
    let badgeProvider: (String) -> LayoutNavBadge?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: LayoutStrings.navPinned)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .padding(.horizontal, TSSpacing.sm)
            ForEach(items) { item in
                HStack(spacing: TSSpacing.xs) {
                    LayoutNavItemRow(
                        item: item,
                        isActive: LayoutProjector.isActivePath(activePathname, item.to),
                        badge: badgeProvider(item.to),
                        onSelect: onSelect
                    )
                    Button { onUnpin(item.to) } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.TS.textMuted)
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: LayoutStrings.navUnpinPage(item.label)))
                }
            }
        }
    }
}

// MARK: - Sections group (web sections block + expand/collapse all)

/// The Sections group — the SwiftUI parity of the web sections block: a "Sections" header with Expand-all /
/// Collapse-all (disabled at the extremes, like the web) and the collapsible section rows.
struct LayoutSectionsGroup: View {
    let sections: [LayoutNavSection]
    let expandedCount: Int
    let activePathname: String
    let isExpanded: (String) -> Bool
    let onToggleSection: (String) -> Void
    let onExpandAll: () -> Void
    let onCollapseAll: () -> Void
    let onSelect: (String) -> Void
    let badgeProvider: (String) -> LayoutNavBadge?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            ForEach(sections) { section in
                LayoutSectionRow(
                    section: section,
                    isExpanded: isExpanded(section.title),
                    activePathname: activePathname,
                    onToggle: onToggleSection,
                    onSelect: onSelect,
                    badgeProvider: badgeProvider
                )
            }
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: LayoutStrings.navSections)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.xs)
            iconButton(
                systemName: "chevron.down.square",
                label: LayoutStrings.navExpandAll,
                disabled: expandedCount == sections.count,
                action: onExpandAll
            )
            iconButton(
                systemName: "chevron.up.square",
                label: LayoutStrings.navCollapseAll,
                disabled: expandedCount == 0,
                action: onCollapseAll
            )
        }
        .padding(.horizontal, TSSpacing.sm)
    }

    private func iconButton(
        systemName: String,
        label: String,
        disabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(disabled ? Color.TS.textMuted.opacity(0.4) : Color.TS.textMuted)
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Sidebar body (model-bound)

/// The sidebar navigation body — the SwiftUI parity of the web sidebar nav: the active-section card, the
/// Pinned group, the (feature-flagged) Recently Used group, and the Sections group. Bound to the model so it
/// reflects pin/expand/route changes; routes scroll naturally in the enclosing `ScrollView`.
struct LayoutSidebarBody: View {
    @Bindable var model: LayoutModel

    var body: some View {
        let projection = model.projection
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if let entry = projection.activeEntry {
                LayoutActiveCard(entry: entry, isPinned: projection.activeIsPinned) { model.toggleActivePin() }
            }
            if !projection.pinnedItems.isEmpty {
                LayoutPinnedGroup(
                    items: projection.pinnedItems,
                    activePathname: model.pathname,
                    onSelect: { model.select($0) },
                    onUnpin: { model.unpin($0) },
                    badgeProvider: { model.badge(for: $0) }
                )
            }
            if model.showRecentlyUsed, !projection.recentItems.isEmpty {
                recentGroup(projection.recentItems)
            }
            LayoutSectionsGroup(
                sections: projection.sections,
                expandedCount: projection.expandedSectionCount,
                activePathname: model.pathname,
                isExpanded: { model.isExpanded($0) },
                onToggleSection: { model.toggleSection($0) },
                onExpandAll: { model.expandAll() },
                onCollapseAll: { model.collapseAll() },
                onSelect: { model.select($0) },
                badgeProvider: { model.badge(for: $0) }
            )
        }
        .padding(TSSpacing.sm)
    }

    private func recentGroup(_ items: [LayoutNavItem]) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: LayoutStrings.navRecentlyUsed)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .padding(.horizontal, TSSpacing.sm)
            ForEach(items) { item in
                LayoutNavItemRow(
                    item: item,
                    isActive: LayoutProjector.isActivePath(model.pathname, item.to),
                    badge: model.badge(for: item.to),
                    onSelect: { model.select($0) }
                )
            }
        }
    }
}
