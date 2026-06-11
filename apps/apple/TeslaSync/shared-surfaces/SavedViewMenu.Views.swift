//
//  SavedViewMenu.Views.swift
//  TeslaSync — P4 shared surface · 0102 · SavedViewMenu (Apple)
//
//  The presentational leaves of the saved-views menu: the trigger button (the web Bookmark /
//  BookmarkCheck button whose label collapses to the active view name), one menu row (the web
//  popover `<li>`: an apply tap target with the default star, plus the default / pin / rename / delete
//  affordances), the per-row icon button, and the "applied" badge (web `View: {name} ✕`). All consume
//  the P1/S10 facade (via the resolved strings) and the shared P1/S9 tokens — no networking, no
//  Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Trigger (web Bookmark / BookmarkCheck button)

/// The trigger button — web `variant={activeView ? 'primary' : 'secondary'}` with the Bookmark /
/// BookmarkCheck icon and the label that collapses to the active view name. Opens the popover.
struct SavedViewMenuTrigger: View {
    let resolved: SavedViewMenuResolved
    let onTap: () -> Void

    var body: some View {
        TSButton(
            variant: resolved.hasActiveView ? .primary : .secondary,
            size: .small,
            action: onTap
        ) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: resolved.hasActiveView ? "bookmark.fill" : "bookmark")
                    .font(.system(size: 12, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: resolved.triggerLabel)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: 180, alignment: .leading)
            }
        }
        .accessibilityLabel(Text(verbatim: resolved.triggerLabel))
        .accessibilityIdentifier("saved-view-trigger")
    }
}

// MARK: - Row icon button (web row action `<button>`)

/// One per-row action button — a token-tinted SF Symbol with a comfortable hit area and an explicit
/// VoiceOver label (the web row affordances flip their `aria-label` with the row state).
struct SavedViewRowIconButton: View {
    let systemName: String
    let label: String
    var tint: Color = .TS.textMuted
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(tint)
                .frame(minWidth: 34, minHeight: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Menu row (web popover / manage `<li>`)

/// One saved-view row — the web popover `<li>`: a leading apply tap target (the default star + the
/// view name, highlighted when applied) and the trailing default / pin / rename / delete affordances.
/// Shared by the popover list and the manage dialog.
struct SavedViewMenuRow: View {
    let row: SavedViewRow
    let onApply: () -> Void
    let onToggleDefault: () -> Void
    let onTogglePin: () -> Void
    let onRename: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            applyButton
            SavedViewRowIconButton(
                systemName: row.isDefault ? "star.fill" : "star",
                label: row.defaultToggleLabel,
                tint: row.isDefault ? Color.TS.statusWarning : Color.TS.textMuted,
                action: onToggleDefault
            )
            SavedViewRowIconButton(
                systemName: row.isPinned ? "pin.slash" : "pin",
                label: row.pinToggleLabel,
                tint: row.isPinned ? Color.TS.accent : Color.TS.textMuted,
                action: onTogglePin
            )
            SavedViewRowIconButton(systemName: "pencil", label: row.renameLabel, action: onRename)
            SavedViewRowIconButton(
                systemName: "trash",
                label: row.deleteLabel,
                tint: Color.TS.statusDanger,
                action: onDelete
            )
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(rowBackground)
        .accessibilityElement(children: .contain)
    }

    private var applyButton: some View {
        Button(action: onApply) {
            HStack(spacing: TSSpacing.xs) {
                if row.isDefault {
                    Image(systemName: "star.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.TS.statusWarning)
                        .accessibilityHidden(true)
                }
                Text(verbatim: row.name)
                    .font(Font.TS.body)
                    .foregroundStyle(row.isActive ? Color.TS.textPrimary : Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: row.applyAccessibilityLabel))
        .accessibilityAddTraits(row.isActive ? [.isButton, .isSelected] : .isButton)
    }

    private var rowBackground: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(row.isActive ? Color.TS.accent.opacity(0.10) : Color.clear)
    }
}

// MARK: - Applied badge (web `View: {name} ✕`)

/// The "applied" badge — web `<Badge>View: {name} ✕</Badge>`. Shown when a saved view matches the
/// current query; the trailing button clears the applied view (web `handleClear`).
struct SavedViewAppliedBadge: View {
    let resolved: SavedViewMenuResolved
    let onClear: () -> Void

    var body: some View {
        if let active = resolved.activeView {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: "\(resolved.appliedBadgeLabel): \(active.name)")
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.accent)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: 180, alignment: .leading)
                Button(action: onClear) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Color.TS.textMuted)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: resolved.clearAppliedLabel))
                .accessibilityIdentifier("saved-view-clear-applied")
            }
            .padding(.leading, TSSpacing.sm)
            .padding(.trailing, 2)
            .padding(.vertical, 2)
            .background(Color.TS.accent.opacity(0.12), in: Capsule())
            .accessibilityElement(children: .contain)
        }
    }
}
