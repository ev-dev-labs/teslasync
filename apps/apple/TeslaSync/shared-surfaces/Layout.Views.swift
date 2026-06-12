//
//  Layout.Views.swift
//  TeslaSync — P4 shared surface · 0169 · Layout (Apple)
//
//  The navigation leaf views of the app shell — the native peers of the web sidebar elements: a destination
//  row (web `renderNavLink` — the tinted icon box + label + count chip + active indicator), the per-item
//  count chip (web neon badges), a collapsible section (web `<nav>` section button + animated item list), and
//  the active-section card (web "Current" card with the Pin/Pinned toggle). All chrome is token-driven
//  (P1/S9); every interactive element carries a VoiceOver label; data labels (item label / section title)
//  render verbatim because the web renders them as authored. No networking — every tap routes through the
//  state-holder.
//

import SwiftUI

// MARK: - Count chip (web per-item neon badge)

/// A sidebar count chip — the native peer of the web per-item count badge. Tone maps to a status token.
struct LayoutNavBadgeChip: View {
    let badge: LayoutNavBadge

    private var color: Color {
        switch badge.tone {
        case .danger: Color.TS.statusDanger
        case .info: Color.TS.statusInfo
        case .warning: Color.TS.statusWarning
        }
    }

    var body: some View {
        Text(verbatim: badge.text)
            .font(Font.TS.caption)
            .fontWeight(.bold)
            .monospacedDigit()
            .foregroundStyle(color)
            .padding(.horizontal, TSSpacing.xs)
            .frame(minWidth: 20, minHeight: 18)
            .background(color.opacity(0.18), in: Capsule())
            .overlay(Capsule().strokeBorder(color.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Destination row (web `renderNavLink`)

/// One navigation destination — the SwiftUI parity of the web `renderNavLink`: a tinted icon box, the
/// verbatim label, an optional count chip, and an active indicator. A button that routes through `onSelect`.
struct LayoutNavItemRow: View {
    let item: LayoutNavItem
    let isActive: Bool
    let badge: LayoutNavBadge?
    let onSelect: (String) -> Void

    var body: some View {
        Button { onSelect(item.to) } label: {
            HStack(spacing: TSSpacing.sm) {
                icon
                Text(verbatim: item.label)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(isActive ? Color.TS.textPrimary : Color.TS.textSecondary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.xs)
                if let badge { LayoutNavBadgeChip(badge: badge) }
                if isActive {
                    Circle().fill(Color.TS.accent).frame(width: 6, height: 6)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, TSSpacing.sm)
            .frame(minHeight: 36)
            .background(rowBackground)
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: item.label))
        .accessibilityValue(Text(verbatim: badge?.text ?? ""))
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }

    private var icon: some View {
        Image(systemName: item.symbol)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(isActive ? Color.TS.accent : Color.TS.textSecondary)
            .frame(width: 28, height: 28)
            .background(
                isActive ? Color.TS.accent.opacity(0.14) : Color.TS.surface.opacity(0.5),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .accessibilityHidden(true)
    }

    @ViewBuilder private var rowBackground: some View {
        if isActive {
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .fill(Color.TS.surfaceGlass)
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
        } else {
            Color.clear
        }
    }
}

// MARK: - Active-section card (web "Current" card)

/// The active-section card — the SwiftUI parity of the web "Current" card: the active page label + its
/// section, with the Pin/Pinned toggle. The toggle's accessible name flips between pin/unpin per state.
struct LayoutActiveCard: View {
    let entry: LayoutActiveEntry
    let isPinned: Bool
    let onTogglePin: () -> Void

    private var pinLabel: String {
        isPinned ? LayoutStrings.navUnpinCurrent : LayoutStrings.navPinCurrent
    }

    private var pinText: String {
        isPinned ? LayoutStrings.navPinnedAction : LayoutStrings.navPinAction
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: entry.item.label)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Text(verbatim: entry.sectionTitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            pinButton
        }
        .padding(TSSpacing.md)
        .background(Color.TS.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.accent.opacity(0.18), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: LayoutStrings.navCurrentSection))
    }

    private var pinButton: some View {
        Button(action: onTogglePin) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: isPinned ? "star.fill" : "star")
                    .font(.system(size: 12))
                Text(verbatim: pinText)
                    .font(Font.TS.caption)
            }
            .foregroundStyle(isPinned ? Color.TS.statusWarning : Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surface.opacity(0.6), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: pinLabel))
        .accessibilityAddTraits(isPinned ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Collapsible section (web `<nav>` section button + item list)

/// A collapsible navigation section — the SwiftUI parity of the web section button + animated item list: a
/// header (icon, verbatim title, item-count chip, chevron) that toggles, revealing the destination rows.
struct LayoutSectionRow: View {
    let section: LayoutNavSection
    let isExpanded: Bool
    let activePathname: String
    let onToggle: (String) -> Void
    let onSelect: (String) -> Void
    let badgeProvider: (String) -> LayoutNavBadge?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            if isExpanded {
                VStack(spacing: 2) {
                    ForEach(section.items) { item in
                        LayoutNavItemRow(
                            item: item,
                            isActive: LayoutProjector.isActivePath(activePathname, item.to),
                            badge: badgeProvider(item.to),
                            onSelect: onSelect
                        )
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.fastDuration), value: isExpanded)
    }

    private var header: some View {
        Button { onToggle(section.title) } label: {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: section.title)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.xs)
                Text(verbatim: String(section.items.count))
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .rotationEffect(.degrees(isExpanded ? 0 : -90))
            }
            .padding(.horizontal, TSSpacing.sm)
            .frame(minHeight: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: section.title))
        .accessibilityValue(Text(verbatim: String(section.items.count)))
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(Text(verbatim: LayoutStrings.openSection))
    }
}
