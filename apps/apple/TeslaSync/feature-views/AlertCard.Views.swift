//
//  AlertCard.Views.swift
//  TeslaSync — P4 feature view · 0179 · AlertCard (Apple)
//
//  The presentational subviews of the loaded AlertCard — the native port of the
//  web card's severity icon box, the title + message drill-through block, the
//  unread status dot, the meta row (relative time, severity chip, type, the
//  acknowledged badge, and the live freshness chip), and the trailing action
//  cluster (View context / Audit timeline / Acknowledge|Reopened / Mark read).
//  Each piece reads its copy through the injected `AlertCardLocalizer`; no English
//  is hardcoded. The load/empty/error chrome + the card container live in
//  `AlertCard.swift`.
//

import SwiftUI

// MARK: - Flow layout (wrapping rows — web `flex flex-wrap`)

/// A minimal left-aligned wrapping layout (native parity of the web meta row's
/// `flex items-center gap-3 flex-wrap`). Lays subviews left-to-right, wrapping to a
/// new line when the next subview would overflow the proposed width.
struct AlertFlowLayout: Layout {
    var horizontalSpacing: CGFloat = TSSpacing.sm
    var verticalSpacing: CGFloat = TSSpacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        layout(maxWidth: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let frames = layout(maxWidth: bounds.width, subviews: subviews).frames
        for index in subviews.indices {
            let frame = frames[index]
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func layout(maxWidth: CGFloat, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        var frames: [CGRect] = []
        var origin = CGPoint.zero
        var rowHeight: CGFloat = 0
        var contentWidth: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if origin.x > 0, origin.x + size.width > maxWidth {
                origin.x = 0
                origin.y += rowHeight + verticalSpacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: origin, size: size))
            origin.x += size.width + horizontalSpacing
            rowHeight = Swift.max(rowHeight, size.height)
            contentWidth = Swift.max(contentWidth, origin.x - horizontalSpacing)
        }
        return (CGSize(width: contentWidth, height: origin.y + rowHeight), frames)
    }
}

// MARK: - Severity icon box (web tinted `ring-1` icon box)

/// The leading icon box: the per-type SF Symbol tinted by the normalized severity,
/// over a soft severity fill + ring (web `rounded-xl p-2.5 ring-1` with the
/// `severityTokens` bg/border/fg).
struct AlertCardIconBox: View {
    let type: String
    let severity: AlertSeverity

    var body: some View {
        Image(systemName: AlertTypeIcon.systemImage(for: type))
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(severity.tone.color)
            .frame(width: 40, height: 40)
            .background(
                severity.tone.color.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(severity.tone.color.opacity(0.3), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Unread dot (web `StatusDot animate-pulse`)

/// The unread marker: a severity-tinted dot that pulses (Reduce Motion honored)
/// and announces "Unread" — the web `<StatusDot severity label={t('Unread')} />`.
struct AlertUnreadDot: View {
    let tone: TSTone
    let label: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(tone.color)
            .frame(width: 8, height: 8)
            .scaleEffect(pulse && !reduceMotion ? 1.3 : 1)
            .opacity(pulse && !reduceMotion ? 0.5 : 1)
            .animation(
                reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true),
                value: pulse
            )
            .onAppear { pulse = true }
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Header (title + message drill-through block + unread dot)

/// The web row of the title/message `<Link to={drillHref}>` plus the trailing
/// unread `StatusDot`. The whole title block is a single navigable, accessible
/// element that hands the resolved drill-through to `onViewContext`.
struct AlertCardHeaderRow: View {
    let data: AlertCardData
    let severity: AlertSeverity
    let drill: AlertDrillthrough
    let now: Date
    let localize: AlertCardLocalizer
    let onViewContext: (AlertDrillthrough) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Button {
                onViewContext(drill)
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: data.title)
                        .font(Font.TS.body)
                        .fontWeight(.medium)
                        .foregroundStyle(data.isRead ? Color.TS.textSecondary : Color.TS.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if !data.message.isEmpty {
                        Text(verbatim: data.message)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                            .lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: AlertCardAccessibility.cardLabel(
                for: data,
                now: now,
                localize: localize
            )))
            .accessibilityHint(Text(verbatim: AlertCardAccessibility.viewContextLabel(localize)))
            .accessibilityAddTraits(.isButton)

            if !data.isRead {
                AlertUnreadDot(tone: severity.tone, label: AlertCardAccessibility.unreadLabel(localize))
                    .padding(.top, 4)
            }
        }
    }
}

// MARK: - Meta chips (web `flex-wrap` info row)

/// Relative time with a leading clock (web `text-[10px]` + clock icon).
struct AlertTimeChip: View {
    let text: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "clock").font(.system(size: 10))
            Text(verbatim: text).font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityElement(children: .combine)
    }
}

/// The raw severity rendered verbatim, tinted by the normalized tone — the web
/// `<SeverityBadge severity size="sm" showIcon={false}>{alert.severity}</…>`.
struct AlertSeverityChip: View {
    let rawSeverity: String
    let tone: TSTone

    var body: some View {
        Text(verbatim: rawSeverity)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: rawSeverity))
    }
}

/// The human alert type (web `(type ?? 'notification').replace(/_/g, ' ')`).
struct AlertTypeChip: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
    }
}

/// The acknowledged badge (web `<Badge variant="success" size="sm">`).
struct AlertAckedBadge: View {
    let text: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "checkmark.seal.fill").font(.system(size: 10))
            Text(verbatim: text).font(Font.TS.caption).fontWeight(.medium).lineLimit(1)
        }
        .foregroundStyle(Color.TS.statusSuccess)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Color.TS.statusSuccess.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.statusSuccess.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// The live-stream freshness chip (stale / offline) — native chrome for the P4
/// stale/offline states.
struct AlertFreshnessChipView: View {
    let chip: AlertFreshnessChip
    let localize: AlertCardLocalizer

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: chip.systemImage).font(.system(size: 10, weight: .semibold))
            Text(verbatim: localize.string(chip.labelKey, chip.labelFallback))
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(chip.tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(chip.tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(chip.tone.color.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: localize.string(chip.labelKey, chip.labelFallback)))
    }
}

/// The web meta row: time · severity · type · acknowledged · freshness, wrapping.
struct AlertCardMetaRow: View {
    let data: AlertCardData
    let severity: AlertSeverity
    let freshness: AlertFreshnessChip?
    let now: Date
    let localize: AlertCardLocalizer

    var body: some View {
        AlertFlowLayout(horizontalSpacing: TSSpacing.sm, verticalSpacing: TSSpacing.xs) {
            AlertTimeChip(text: AlertTimeFormat.timeAgo(data.createdAt, now: now, localize: localize))
            AlertSeverityChip(rawSeverity: data.severity, tone: severity.tone)
            AlertTypeChip(text: AlertTypeIcon.displayLabel(for: data.type))
            if let ack = AlertAckBadge.label(for: data, localize: localize) {
                AlertAckedBadge(text: ack)
            }
            if let freshness {
                AlertFreshnessChipView(chip: freshness, localize: localize)
            }
        }
    }
}

// MARK: - Action cluster (web trailing ghost buttons)

/// The trailing action row: View context, Audit timeline, the acknowledge/reopen
/// toggle, and (when unread) Mark read — each a ghost button with an icon + label.
struct AlertCardActionsRow: View {
    let data: AlertCardData
    let drill: AlertDrillthrough
    let ackAction: AlertAckAction
    let actions: AlertCardActions
    let localize: AlertCardLocalizer

    var body: some View {
        AlertFlowLayout(horizontalSpacing: TSSpacing.sm, verticalSpacing: TSSpacing.xs) {
            actionButton(icon: "arrow.up.forward", titleKey: "alerts.viewContext", fallback: "View context") {
                actions.onViewContext(drill)
            }
            actionButton(icon: "bell.badge", titleKey: "alerts.timeline.title", fallback: "Audit timeline") {
                actions.onOpenDetail(data.id)
            }
            actionButton(icon: ackAction.systemImage, titleKey: ackAction.labelKey, fallback: ackAction.labelFallback) {
                dispatchAck()
            }
            if !data.isRead {
                actionButton(icon: "eye", titleKey: "Mark read", fallback: "Mark read") {
                    actions.onMarkRead(data.id)
                }
            }
        }
    }

    private func dispatchAck() {
        switch ackAction {
        case .acknowledge: actions.onAcknowledge(data.id)
        case .reopen: actions.onReopen(data.id)
        }
    }

    private func actionButton(
        icon: String,
        titleKey: String,
        fallback: String,
        action: @escaping () -> Void
    ) -> some View {
        TSButton(variant: .ghost, size: .small, action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: icon).font(.system(size: 11, weight: .semibold))
                Text(verbatim: localize.string(titleKey, fallback))
            }
        }
        .accessibilityLabel(Text(verbatim: localize.string(titleKey, fallback)))
    }
}
