//
//  CollapsibleCommandGroup.Views.swift
//  TeslaSync — P4 feature view · 0224 · CollapsibleCommandGroup (Apple)
//
//  The presentational sub-views composed by `CollapsibleCommandGroup`: the
//  disclosure header row (web `<ControlButton>` content — icon, uppercase label,
//  count, rotating chevron) and the friendly empty state shown when an expanded
//  group has no commands (the P4 leaf "never a blank box" rule). Both are pure
//  functions of the projection so they preview and test without a host.
//

import SwiftUI

// MARK: - Header row (web `<Icon/> <label/> ({count}) <ChevronDown/>`)

/// The content of the disclosure toggle: the decorative category glyph, the
/// uppercased group label, the parenthesised command count, and a chevron that
/// rotates 180° when expanded (web `open && 'rotate-180'`). Reduce Motion drops
/// the rotation animation.
struct CollapsibleCommandGroupHeaderContent: View {
    let projection: CollapsibleCommandGroupProjection
    let isExpanded: Bool
    let reduceMotion: Bool

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: projection.systemImage)
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 16, height: 16)
                .accessibilityHidden(true)

            Text(verbatim: projection.label)
                .font(Font.TS.label)
                .fontWeight(.medium)
                .textCase(.uppercase)
                .tracking(TSTypeMetrics.labelTracking)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)

            Text(verbatim: projection.countBadge)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)

            Spacer(minLength: TSSpacing.sm)

            Image(systemName: "chevron.down")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .rotationEffect(.degrees(isExpanded ? 180 : 0))
                .animation(
                    reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration),
                    value: isExpanded
                )
                .accessibilityHidden(true)
        }
        .padding(.vertical, TSSpacing.sm)
        .contentShape(Rectangle())
    }
}

// MARK: - Empty state (web would render an empty grid → friendly empty surface)

/// The friendly empty state shown when an expanded group has no commands. The web
/// source would render an empty grid here; the P4 leaf contract requires a
/// never-blank surface, so the native parity shows a `TSEmptyState` keyed to the
/// group's own glyph.
struct CollapsibleCommandGroupEmptyContent: View {
    let projection: CollapsibleCommandGroupProjection

    var body: some View {
        TSEmptyState(
            title: "collapsibleGroup.empty.title",
            message: "collapsibleGroup.empty.message",
            systemImage: projection.systemImage
        )
        .padding(.vertical, TSSpacing.lg)
        .frame(maxWidth: .infinity)
    }
}
