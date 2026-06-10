//
//  NotificationRow.Views.swift
//  TeslaSync — P4 feature view · 0191 · NotificationRow (Apple)
//
//  The row chrome composed by `NotificationRow`: the selection toggle, the severity
//  badge, the resolved row body (timestamp + vehicle + rule meta, the title bold when
//  unread, the message), and the trailing action cluster (mark read/unread, archive/
//  restore, and the "View context" drill-through). The state envelope (freshness /
//  banner / loading / empty / error / toast) lives in NotificationRow.Chrome.swift.
//  All copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9).
//

import SwiftUI

// MARK: - Severity palette (web static hue → adaptive semantic tokens)

/// The severity → color / glyph mapping. The web uses `SeverityBadge` static hues;
/// native uses the adaptive semantic tokens so light / dark / high-contrast resolve.
enum NotificationRowSeverityPalette {
    static func color(for kind: NotificationRowSeverityKind) -> Color {
        switch kind {
        case .info: Color.TS.statusInfo
        case .warn: Color.TS.statusWarning
        case .critical: Color.TS.statusDanger
        }
    }

    static func symbol(for kind: NotificationRowSeverityKind) -> String {
        switch kind {
        case .info: "info.circle.fill"
        case .warn: "exclamationmark.triangle.fill"
        case .critical: "exclamationmark.octagon.fill"
        }
    }
}

// MARK: - Severity badge (web `SeverityBadge`)

/// A compact tinted severity chip — the native parity of the web `SeverityBadge`.
struct NotificationRowSeverityBadge: View {
    let kind: NotificationRowSeverityKind

    var body: some View {
        let tint = NotificationRowSeverityPalette.color(for: kind)
        return HStack(spacing: 3) {
            Image(systemName: NotificationRowSeverityPalette.symbol(for: kind))
                .font(.system(size: 9, weight: .bold))
            Text(verbatim: NotificationRowStrings.string(kind.localizationKey, kind.fallback))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tint.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
        .accessibilityHidden(true)
    }
}

// MARK: - Selection toggle (web `<input type="checkbox">`)

/// The per-row selection checkbox (web `onSelectionChange(log.id, checked)`), with
/// its own VoiceOver label + checked value so the row stays operable by assistive tech.
struct NotificationRowSelectionToggle: View {
    let selected: Bool
    let selectionValue: String
    let onChange: (Bool) -> Void

    var body: some View {
        Button {
            onChange(!selected)
        } label: {
            Image(systemName: selected ? "checkmark.square.fill" : "square")
                .font(.system(size: 18))
                .foregroundStyle(selected ? Color.TS.accent : Color.TS.textMuted)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: NotificationRowStrings.string(
            "notifications.inbox.row.select",
            "Select notification"
        )))
        .accessibilityValue(Text(verbatim: selectionValue))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Quick-action button (web ghost `Button` with icon)

/// One trailing quick-action icon button (web `Button variant="ghost"`). Shows a
/// spinner + is disabled while any per-row mutation is in flight, and carries its own
/// VoiceOver label.
struct NotificationRowActionButton: View {
    let kind: NotificationRowActionKind
    let systemImage: String
    let labelKey: String
    let labelFallback: String
    let busy: NotificationRowActionKind?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if busy == kind {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: systemImage).font(.system(size: 13, weight: .semibold))
                }
            }
            .frame(width: 28, height: 28)
            .foregroundStyle(Color.TS.textMuted)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy != nil)
        .accessibilityLabel(Text(verbatim: NotificationRowStrings.string(labelKey, labelFallback)))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - View-context button (web drill-through `<Link>`)

/// The "View context" drill-through affordance (web `<Link to={drillHref}>`),
/// rendered only when the row resolves a rule.
struct NotificationRowViewContextButton: View {
    let onTap: () -> Void

    var body: some View {
        let label = NotificationRowStrings.string("alerts.viewContext", "View context")
        return Button(action: onTap) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(Color.TS.accent)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.12), in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Actions cluster (web trailing action group)

/// The trailing action cluster: mark read/unread, archive/restore, and the
/// drill-through "View context" link. Each button's visibility mirrors the web
/// gating (`!isRead && onMarkRead`, `isRead && onMarkUnread`, etc.).
struct NotificationRowActionsCluster: View {
    let row: NotificationRowProjection
    let capabilities: NotificationRowCapabilities
    let busy: NotificationRowActionKind?
    let onMarkRead: () -> Void
    let onMarkUnread: () -> Void
    let onArchive: () -> Void
    let onUnarchive: () -> Void
    let onViewContext: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if capabilities.markRead, !row.isRead {
                NotificationRowActionButton(
                    kind: .markRead,
                    systemImage: "envelope.open",
                    labelKey: "notifications.inbox.row.markRead",
                    labelFallback: "Mark as read",
                    busy: busy,
                    action: onMarkRead
                )
            }
            if capabilities.markUnread, row.isRead {
                NotificationRowActionButton(
                    kind: .markUnread,
                    systemImage: "envelope.fill",
                    labelKey: "notifications.inbox.row.markUnread",
                    labelFallback: "Mark as unread",
                    busy: busy,
                    action: onMarkUnread
                )
            }
            if capabilities.archive, !row.isArchived {
                NotificationRowActionButton(
                    kind: .archive,
                    systemImage: "archivebox",
                    labelKey: "notifications.inbox.row.archive",
                    labelFallback: "Archive",
                    busy: busy,
                    action: onArchive
                )
            }
            if capabilities.unarchive, row.isArchived {
                NotificationRowActionButton(
                    kind: .unarchive,
                    systemImage: "tray.and.arrow.up",
                    labelKey: "notifications.inbox.row.unarchive",
                    labelFallback: "Restore",
                    busy: busy,
                    action: onUnarchive
                )
            }
            if row.drillthrough != nil {
                NotificationRowViewContextButton(onTap: onViewContext)
            }
        }
    }
}

// MARK: - Row body (web `flex-1 min-w-0` column)

/// The resolved row body: the wrapping meta line (severity, timestamp, vehicle, rule),
/// the title (bold when unread, secondary when read), and the message. Activatable as
/// a unit (web row-body click → `onActivate`) when the parent supplies the handler.
struct NotificationRowBody: View {
    let row: NotificationRowProjection
    let canActivate: Bool
    let onActivate: () -> Void

    private var meta: some View {
        NotificationRowMetaFlow(spacing: TSSpacing.sm) {
            NotificationRowSeverityBadge(kind: row.severity)
            Text(verbatim: NotificationRowFormat.timestamp(row.createdAt))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if let vehicle = row.vehicleName, !vehicle.isEmpty {
                Text(verbatim: "· \(vehicle)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            if let rule = row.ruleName, !rule.isEmpty {
                Text(verbatim: "· \(rule)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
    }

    private var column: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            meta
            Text(verbatim: row.title)
                .font(Font.TS.body)
                .fontWeight(row.isRead ? .regular : .semibold)
                .foregroundStyle(row.isRead ? Color.TS.textSecondary : Color.TS.textPrimary)
                .lineLimit(2)
            if !row.message.isEmpty {
                Text(verbatim: row.message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    var body: some View {
        Group {
            if canActivate {
                Button(action: onActivate) { column }
                    .buttonStyle(.plain)
            } else {
                column
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: NotificationRowAccessibility.rowLabel(
            row,
            localize: NotificationRowStrings.string
        )))
        .accessibilityAddTraits(canActivate ? .isButton : [])
    }
}

// MARK: - Row card (web `role="row"` container)

/// The full inbox row: the selection toggle, the row body, and the action cluster,
/// with the unread left-edge accent bar + stronger fill (web
/// `border-l-2 border-l-cyan-400/70` + `bg-white/[0.03]`).
struct NotificationRowCardView: View {
    let row: NotificationRowProjection
    let selected: Bool
    let selectionValue: String
    let capabilities: NotificationRowCapabilities
    let busy: NotificationRowActionKind?
    let onSelectionChange: (Bool) -> Void
    let onActivate: () -> Void
    let onMarkRead: () -> Void
    let onMarkUnread: () -> Void
    let onArchive: () -> Void
    let onUnarchive: () -> Void
    let onViewContext: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Rectangle()
                .fill(row.isRead ? Color.clear : Color.TS.accent.opacity(0.7))
                .frame(width: 3)
                .clipShape(Capsule())
                .accessibilityHidden(true)
            NotificationRowSelectionToggle(
                selected: selected,
                selectionValue: selectionValue,
                onChange: onSelectionChange
            )
            NotificationRowBody(row: row, canActivate: capabilities.activate, onActivate: onActivate)
            NotificationRowActionsCluster(
                row: row,
                capabilities: capabilities,
                busy: busy,
                onMarkRead: onMarkRead,
                onMarkUnread: onMarkUnread,
                onArchive: onArchive,
                onUnarchive: onUnarchive,
                onViewContext: onViewContext
            )
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            row.isRead ? Color.TS.surfaceGlass : Color.TS.accent.opacity(0.05),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .opacity(row.isRead ? 0.92 : 1)
    }
}

// MARK: - Meta flow (wrapping HStack — web `flex flex-wrap`)

/// A lightweight wrapping row layout, the native parity of web `flex flex-wrap`. Lays
/// children left-to-right, wrapping to a new line when the proposed width is exceeded.
struct NotificationRowMetaFlow: Layout {
    var spacing: CGFloat = TSSpacing.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rows = 1
        var rowX: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowX > 0, rowX + size.width > maxWidth {
                rows += 1
                totalHeight += rowHeight + spacing
                rowX = 0
                rowHeight = 0
            }
            rowX += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        totalHeight += rowHeight
        let width = proposal.width ?? rowX
        return CGSize(width: width, height: rows == 0 ? 0 : totalHeight)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal _: ProposedViewSize,
        subviews: Subviews,
        cache _: inout ()
    ) {
        var posX = bounds.minX
        var posY = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if posX > bounds.minX, posX + size.width > bounds.maxX {
                posX = bounds.minX
                posY += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: posX, y: posY), proposal: ProposedViewSize(size))
            posX += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
