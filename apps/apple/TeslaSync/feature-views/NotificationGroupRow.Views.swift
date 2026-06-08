//
//  NotificationGroupRow.Views.swift
//  TeslaSync — P4 feature view · 0190 · NotificationGroupRow (Apple)
//
//  The content chrome composed by `NotificationGroupRow`: the latest member row, the
//  grouping chip row (expand/collapse "+N similar", unread chip, "N vehicles
//  affected", "Mark group read"), and the lazily-loaded expanded member region (web
//  loading / error / "no thread members" branches). The state envelope (freshness /
//  banner / loading / empty / error / toast) lives in NotificationGroupRow.Chrome.swift.
//  All copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9).
//

import SwiftUI

// MARK: - Severity palette (web static hue → adaptive semantic tokens)

/// The severity → color / glyph mapping. The web uses `SeverityBadge` static hues;
/// native uses the adaptive semantic tokens so light / dark / high-contrast resolve.
enum NotificationSeverityPalette {
    static func color(for kind: NotificationSeverityKind) -> Color {
        switch kind {
        case .info: Color.TS.statusInfo
        case .warn: Color.TS.statusWarning
        case .critical: Color.TS.statusDanger
        }
    }

    static func symbol(for kind: NotificationSeverityKind) -> String {
        switch kind {
        case .info: "info.circle.fill"
        case .warn: "exclamationmark.triangle.fill"
        case .critical: "exclamationmark.octagon.fill"
        }
    }
}

// MARK: - Severity badge (web `SeverityBadge`)

/// A compact tinted severity chip — the native parity of the web `SeverityBadge`.
struct NotificationSeverityBadge: View {
    let kind: NotificationSeverityKind

    var body: some View {
        let tint = NotificationSeverityPalette.color(for: kind)
        return HStack(spacing: 3) {
            Image(systemName: NotificationSeverityPalette.symbol(for: kind))
                .font(.system(size: 9, weight: .bold))
            Text(verbatim: NotificationGroupStrings.string(kind.localizationKey, kind.fallback))
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

// MARK: - Member row (web `NotificationRow` — the composed latest/member row)

/// One resolved notification row: the severity badge, timestamp, vehicle + rule
/// meta, the title (bold when unread), and the message. Unread rows get a left
/// accent bar + a slightly stronger fill (web `border-l-2 border-l-cyan-400/70`).
struct NotificationMemberRowView: View {
    let row: NotificationLogProjection

    private var meta: some View {
        HStack(spacing: TSSpacing.sm) {
            NotificationSeverityBadge(kind: row.severity)
            Text(verbatim: NotificationGroupFormat.timestamp(row.createdAt))
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

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Rectangle()
                .fill(row.isRead ? Color.clear : Color.TS.accent.opacity(0.7))
                .frame(width: 3)
                .accessibilityHidden(true)
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
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            Spacer(minLength: 0)
        }
        .background(row.isRead ? Color.TS.surface : Color.TS.accent.opacity(0.05))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: NotificationGroupAccessibility.rowLabel(
            row,
            localize: NotificationGroupStrings.string
        )))
    }
}

// MARK: - Expand toggle (web "+N similar" caret button)

/// The expand/collapse caret that inlines the rest of the thread (web
/// `setExpanded((v) => !v)`), showing "+N similar" with a chevron.
struct NotificationExpandToggle: View {
    let expanded: Bool
    let extraCount: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                Text(verbatim: NotificationGroupCopy.similarChip(
                    extraCount: extraCount,
                    localize: NotificationGroupStrings.string
                ))
                .font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.accent)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 3)
            .background(Color.TS.accent.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.accent.opacity(0.25), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: NotificationGroupCopy.expandLabel(
            expanded: expanded,
            extraCount: extraCount,
            localize: NotificationGroupStrings.string
        )))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Unread chip (web amber unread-count pill)

/// The unread-count chip beside the latest row (web `group.unread_count` pill).
struct NotificationUnreadChip: View {
    let count: Int

    var body: some View {
        Text(verbatim: NotificationGroupFormat.count(count))
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .monospacedDigit()
            .foregroundStyle(Color.TS.statusWarning)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.statusWarning.opacity(0.12), in: Capsule())
            .accessibilityLabel(Text(verbatim: String.localizedStringWithFormat(
                NotificationGroupStrings.string("notifications.group.a11y.unreadCount", "%lld unread"),
                count
            )))
    }
}

// MARK: - Mark group read button (web ghost `Button`)

/// The group-scoped "Mark group read" action (web `handleMarkGroupRead`), disabled
/// + spinner-decorated while the mutation is in flight (web `bulkMarkRead.isPending`).
struct NotificationMarkGroupReadButton: View {
    let marking: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                if marking {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: "envelope.open").font(.system(size: 11, weight: .semibold))
                }
                Text(verbatim: NotificationGroupStrings.string("notifications.group.markRead", "Mark group read"))
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
            }
            .foregroundStyle(Color.TS.accent)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 3)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(marking)
        .accessibilityLabel(Text(verbatim: NotificationGroupStrings.string(
            "notifications.group.markRead",
            "Mark group read"
        )))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Grouping chip row (web `mt-1 flex flex-wrap …`)

/// The grouping affordance row beneath the latest member: the expand toggle, the
/// unread chip, the "N vehicles affected" hint, and the "Mark group read" action.
/// Renders only when web `!isSingleton && (extraCount > 0 || unread_count > 1)`.
struct NotificationGroupChips: View {
    let group: NotificationGroupProjection
    let expanded: Bool
    let marking: Bool
    let onToggle: () -> Void
    let onMarkRead: () -> Void

    var body: some View {
        NotificationFlowRow(spacing: TSSpacing.sm) {
            if group.showsExpandToggle {
                NotificationExpandToggle(expanded: expanded, extraCount: group.extraCount, action: onToggle)
            }
            if group.showsUnreadChip {
                NotificationUnreadChip(count: group.unreadCount)
            }
            if group.showsVehicleAffected {
                Text(verbatim: NotificationGroupCopy.vehiclesAffected(
                    count: group.vehicleAffectedCount,
                    localize: NotificationGroupStrings.string
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            }
            if group.canMarkGroupRead {
                NotificationMarkGroupReadButton(marking: marking, action: onMarkRead)
            }
        }
        .padding(.horizontal, TSSpacing.sm)
    }
}

// MARK: - Members region (web expanded `role="region"`)

/// The expanded thread-member list with its leading rail (web
/// `border-l-2 border-white/[0.06] pl-3`). Switches over the lazily-loaded region
/// phase so the web loading / error / "no thread members" / list branches all render.
struct NotificationMembersRegion: View {
    let phase: NotificationMembersPhase

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(Color.TS.border)
                .frame(width: 2)
                .accessibilityHidden(true)
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, TSSpacing.md)
        .padding(.top, TSSpacing.xs)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .idle:
            EmptyView()
        case .loading:
            HStack(spacing: TSSpacing.sm) {
                ProgressView().controlSize(.mini)
                Text(verbatim: NotificationGroupStrings.string(
                    "notifications.group.loadingMembers",
                    "Loading thread members…"
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.vertical, TSSpacing.sm)
            .accessibilityElement(children: .combine)
        case .error:
            Text(verbatim: NotificationGroupStrings.string(
                "notifications.group.membersError",
                "Could not load thread members"
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.statusDanger)
            .padding(.vertical, TSSpacing.sm)
        case .empty:
            Text(verbatim: NotificationGroupStrings.string(
                "notifications.group.noMembers",
                "No thread members found"
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.vertical, TSSpacing.sm)
        case let .loaded(rows):
            VStack(spacing: TSSpacing.xs) {
                ForEach(rows) { NotificationMemberRowView(row: $0) }
            }
        }
    }
}

// MARK: - FlowRow (wrapping HStack — web `flex flex-wrap`)

/// A lightweight wrapping row layout, the native parity of web `flex flex-wrap`.
/// Lays children left-to-right, wrapping to a new line when the width is exceeded.
struct NotificationFlowRow: Layout {
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
