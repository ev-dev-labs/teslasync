//
//  LayoutSwitcher.Views.swift
//  TeslaSync — P4 feature view · 0126 · LayoutSwitcher (Apple)
//
//  The presentational subviews of the LayoutSwitcher — the native port of the web
//  trigger (Layout label + active name + dirty/pinned chips + chevron), the inline
//  toolbar (Edit / Save-as / Reset, shown at regular width like the web `sm:flex`),
//  and the dropdown body (the radio list of visible layouts with default badge +
//  pin glyph + active check, the new-from-current / pin / reset actions, and the
//  footer hint). Each piece reads its copy through the injected
//  `LayoutSwitcherLocalizer`; no English is hardcoded. The state switch + the
//  popover/alert plumbing live in `LayoutSwitcher.swift`.
//

import SwiftUI

// MARK: - Tinted chip (web `Badge`)

/// A compact tinted chip styled like `TSBadge`, but taking an already-resolved
/// `String` so it can render server text (a pinned vehicle name) as well as
/// localized copy, with an optional leading SF Symbol.
struct LayoutChip: View {
    let text: String
    var tone: TSTone = .neutral
    var systemImage: String?

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 10, weight: .semibold))
            }
            Text(verbatim: text)
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Trigger (web dropdown button)

/// The switcher trigger: the "Layout" caption + the active name (truncated) +
/// the optional `dirty` chip, pinned-vehicle chip, and stale/offline freshness
/// chip, ending with a chevron. Used as the popover anchor's label.
struct LayoutSwitcherTrigger: View {
    let activeName: String
    let dirty: Bool
    let pinnedLabel: String?
    let freshness: LayoutFreshnessChip?
    let localize: LayoutSwitcherLocalizer

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: localize.string("layout.label", "Layout"))
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: activeName)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: 160, alignment: .leading)
                .fixedSize(horizontal: true, vertical: false)
            if dirty {
                LayoutChip(text: localize.string("layout.modified", "modified"), tone: .warning)
            }
            if let pinnedLabel {
                LayoutChip(text: pinnedLabel, tone: .neutral, systemImage: "pin.fill")
            }
            if let freshness {
                LayoutChip(
                    text: localize.string(freshness.labelKey, freshness.labelFallback),
                    tone: freshness.tone,
                    systemImage: freshness.systemImage
                )
            }
            Image(systemName: "chevron.down")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }
}

// MARK: - Inline toolbar (web `sm:flex` Edit / Save-as / Reset)

/// The inline control cluster shown at regular width (web `hidden sm:flex`): the
/// optional Edit toggle, the Save-as action, and the Reset action.
struct LayoutSwitcherToolbar: View {
    let editMode: Bool
    let editLabel: LayoutEditLabel
    let hasEditToggle: Bool
    let localize: LayoutSwitcherLocalizer
    let onToggleEdit: () -> Void
    let onSaveAs: () -> Void
    let onReset: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if hasEditToggle {
                TSButton(variant: .ghost, size: .small, action: onToggleEdit) {
                    HStack(spacing: TSSpacing.xs) {
                        Image(systemName: editLabel.systemImage)
                        Text(verbatim: editLabel.label)
                    }
                }
                .accessibilityLabel(Text(verbatim: editLabel.title))
                .accessibilityAddTraits(editMode ? .isSelected : [])
            }
            TSButton(variant: .ghost, size: .small, action: onSaveAs) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "square.and.arrow.down")
                    Text(verbatim: localize.string("layout.saveAsShort", "Save as"))
                }
            }
            .accessibilityLabel(Text(verbatim: localize.string("layout.saveAs", "Save as new layout")))
            TSButton(variant: .ghost, size: .small, action: onReset) {
                Image(systemName: "arrow.counterclockwise")
            }
            .accessibilityLabel(Text(verbatim: localize.string("layout.reset", "Reset to default")))
        }
    }
}

// MARK: - Dropdown row (one visible layout)

/// One radio row in the dropdown: the layout name, its optional "default" badge
/// and pin glyph, and the trailing check when it is the active layout.
struct LayoutRowButton: View {
    let row: LayoutRow
    let localize: LayoutSwitcherLocalizer
    let onSelect: (String) -> Void

    var body: some View {
        Button { onSelect(row.id) } label: {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: row.name)
                    .font(Font.TS.body)
                    .foregroundStyle(row.isActive ? Color.TS.accent : Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if row.isDefault {
                    LayoutChip(text: localize.string("layout.defaultBadge", "default"), tone: .neutral)
                }
                if row.isPinned {
                    Image(systemName: "pin.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(Color.TS.textMuted)
                }
                Spacer(minLength: TSSpacing.sm)
                if row.isActive {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.TS.accent)
                }
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs + 2)
            .background(
                row.isActive ? Color.TS.accent.opacity(0.12) : Color.clear,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: LayoutSwitcherAccessibility.rowLabel(row, localize: localize)))
        .accessibilityAddTraits(row.isActive ? .isSelected : [])
    }
}

// MARK: - Dropdown action row (web menu items)

/// A full-width tappable menu row (web `role="menuitem"`): a leading SF Symbol,
/// the localized title, and an optional destructive/disabled treatment.
struct LayoutActionRow: View {
    let title: String
    let systemImage: String
    var tint: Color = .TS.textPrimary
    var isDestructive: Bool = false
    var isDisabled: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: systemImage)
                    .font(.system(size: 13))
                    .foregroundStyle(iconColor)
                Text(verbatim: title)
                    .font(Font.TS.body)
                    .foregroundStyle(tint)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs + 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.4 : 1)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityAddTraits(isDisabled ? [] : .isButton)
    }

    private var iconColor: Color {
        isDestructive ? tint : Color.TS.textMuted
    }
}

// MARK: - Dropdown body (web popover menu)

/// The dropdown content presented in the popover: the radio list of visible
/// layouts (or the friendly empty line), the new-from-current / pin / reset
/// actions, and the footer hint — every region of the web menu.
struct LayoutSwitcherDropdown: View {
    let rows: [LayoutRow]
    let pinControl: LayoutPinControl?
    let localize: LayoutSwitcherLocalizer
    let onSelect: (String) -> Void
    let onNewFromCurrent: () -> Void
    let onPinToggle: () -> Void
    let onReset: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: localize.string("layout.menuLabel", "Saved layouts"))
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.top, TSSpacing.xs)
                .accessibilityAddTraits(.isHeader)

            layoutList

            Divider().overlay(Color.TS.border)

            LayoutActionRow(
                title: localize.string("layout.newFromCurrent", "New layout from current"),
                systemImage: "plus",
                action: onNewFromCurrent
            )

            if let pinControl {
                LayoutActionRow(
                    title: localize.string(pinControl.labelKey, pinControl.labelFallback),
                    systemImage: pinControl.systemImage,
                    isDisabled: pinControl.isDisabled,
                    action: onPinToggle
                )
            }

            LayoutActionRow(
                title: localize.string("layout.reset", "Reset to default"),
                systemImage: "arrow.counterclockwise",
                tint: Color.TS.statusDanger,
                isDestructive: true,
                action: onReset
            )

            Divider().overlay(Color.TS.border)

            footer
        }
        .padding(TSSpacing.sm)
        .frame(width: 280)
        .accessibilityLabel(Text(verbatim: localize.string("layout.menuLabel", "Saved layouts")))
    }

    @ViewBuilder
    private var layoutList: some View {
        if rows.isEmpty {
            Text(verbatim: localize.string("layout.noneVisible", "No layouts available for this vehicle."))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.sm)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(rows) { row in
                        LayoutRowButton(row: row, localize: localize, onSelect: onSelect)
                    }
                }
            }
            .frame(maxHeight: 288)
        }
    }

    private var footer: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "ellipsis")
                .font(.system(size: 11))
            Text(verbatim: localize.string("layout.menuFooter", "Manage layouts in the tab strip below"))
                .font(Font.TS.caption)
                .textCase(.uppercase)
        }
        .foregroundStyle(Color.TS.textMuted)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.bottom, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}
