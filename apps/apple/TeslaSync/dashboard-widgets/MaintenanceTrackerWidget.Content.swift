//
//  MaintenanceTrackerWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0061 · MaintenanceTrackerWidget (Apple)
//
//  The content-phase body of the surface: the compact (cols ≤ 1) headline layout
//  and the standard next-service card + recent-service timeline, plus the urgency
//  chip. Split from MaintenanceTrackerWidget.swift to keep each file focused.
//

import Foundation
import SwiftUI

// MARK: - Content body (compact + standard layouts)

extension MaintenanceTrackerWidget {
    @ViewBuilder
    var contentBody: some View {
        if isCompact {
            compactContent
        } else {
            standardContent
        }
    }

    /// ── Compact (1×2): months until next + item name (web compact branch) ──
    @ViewBuilder
    private var compactContent: some View {
        if let next = projection.next {
            VStack(spacing: TSSpacing.xs) {
                Image(systemName: "wrench.and.screwdriver.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                Text(verbatim: next.monthsText)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                MaintenanceStrings.text("widget.maintenance.monthsLeft", "months")
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: next.name)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: MaintenanceAccessibility.summary(for: projection)))
        } else {
            emptyState
        }
    }

    /// ── Standard (2×4): next-service card + recent-service timeline ──
    private var standardContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if connection != .live { connectivityBanner }
                if let next = projection.next { nextServiceCard(next) }
                recentServiceSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: MaintenanceAccessibility.summary(for: projection)))
    }

    private func nextServiceCard(_ next: MaintenanceNextService) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .center, spacing: TSSpacing.sm) {
                MaintenanceStrings.text("widget.maintenance.nextService", "Next Service")
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: 0)
                MaintenanceUrgencyBadge(urgency: next.urgency)
            }
            Text(verbatim: next.name)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            HStack(spacing: TSSpacing.md) {
                HStack(spacing: 4) {
                    Image(systemName: "clock").font(.system(size: 10, weight: .semibold))
                    Text(verbatim: intervalLabel(next))
                }
                Text(verbatim: next.distanceText)
                if let cost = next.costText {
                    Text(verbatim: cost)
                }
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(1)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.textPrimary.opacity(0.03),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var recentServiceSection: some View {
        if projection.hasRecords {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                MaintenanceStrings.text("widget.maintenance.recentService", "Recent Service")
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                TSTimeline(entries: timelineEntries)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            MaintenanceStrings.text("widget.maintenance.noRecords", "No service records yet")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, TSSpacing.md)
        }
    }

    /// Web `Every {months} mo` — the interval line of the next-service card.
    private func intervalLabel(_ next: MaintenanceNextService) -> String {
        let every = MaintenanceStrings.string("widget.maintenance.every", "Every")
        let months = MaintenanceStrings.string("widget.maintenance.months", "mo")
        return "\(every) \(next.monthsText) \(months)"
    }

    /// The recent-service rows mapped onto the shared `TSTimeline` (web `Timeline`).
    /// Dynamic strings are interpolated into the `LocalizedStringKey` so they render
    /// verbatim (service item names / odometer / notes are not catalog keys).
    private var timelineEntries: [TSTimelineEntry] {
        projection.timeline.map { row in
            TSTimelineEntry(
                id: row.id,
                title: "\(row.title)",
                detail: "\(row.subtitle)",
                timestamp: row.time,
                tone: .success,
                systemImage: "checkmark.circle.fill"
            )
        }
    }
}

// MARK: - MaintenanceUrgencyBadge (tone + dot chip — web `<Badge variant dot>`)

/// A capsule status chip styled with the shared `TSBadge` / `TSStatusPill` design
/// tokens, extended with a leading state dot and a pre-localized tone label — which
/// the shared `TSBadge` (taking only a `LocalizedStringKey`, no dot) can't express.
/// Mirrors the web `<Badge variant={danger|warning|success} size="sm" dot>`.
private struct MaintenanceUrgencyBadge: View {
    let urgency: MaintenanceUrgency

    private var tone: TSTone {
        switch urgency {
        case .overdue: .danger
        case .soon: .warning
        case .good: .success
        }
    }

    var body: some View {
        let label = MaintenanceUrgencyLabels.label(urgency)
        return HStack(spacing: 4) {
            Circle().fill(tone.color).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}
