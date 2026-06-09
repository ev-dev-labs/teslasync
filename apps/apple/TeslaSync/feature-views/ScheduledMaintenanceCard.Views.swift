//
//  ScheduledMaintenanceCard.Views.swift
//  TeslaSync — P4 feature view · 0251 · ScheduledMaintenanceCard (Apple)
//
//  The body subviews composed by `ScheduledMaintenanceCard`: the active-now block (message + until
//  line + Clear) and the scheduler block (explainer + "Schedule a window" / inline form). Plus the
//  `MaintenanceRingTone` → token-colour mapping for the dynamic panel ring. All consume the P1/S10
//  facade + the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Ring tone → token colours (web dynamic `ringClass`)

extension MaintenanceRingTone {
    /// The 1pt ring colour (web amber `ring-amber-400/40` / blue `ring-blue-400/30` / hairline).
    var ring: Color {
        switch self {
        case .neutral: Color.TS.border
        case .active: Color.TS.statusInfo.opacity(0.35)
        case .imminent: Color.TS.statusWarning.opacity(0.45)
        }
    }

    /// The faint background tint behind the content (web `bg-…-500/[0.04]`).
    var tint: Color {
        switch self {
        case .neutral: Color.clear
        case .active: Color.TS.statusInfo.opacity(0.04)
        case .imminent: Color.TS.statusWarning.opacity(0.05)
        }
    }
}

// MARK: - Active-now block (web `isActive` body)

/// The active-window body — the native mirror of the web `isActive` block: the optional operator
/// message line, the optional "Active until … (N min remaining)" / "Until …" line, and the amber
/// "Clear maintenance" affordance.
struct ScheduledMaintenanceActiveView: View {
    let content: MaintenanceActiveContent
    let isMutating: Bool
    let onClear: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if let message = content.message {
                Text(verbatim: message)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let untilText = content.untilText {
                Text(verbatim: untilText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            clearButton
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var clearButton: some View {
        let label = isMutating
            ? ScheduledMaintenanceStrings.string("scheduled.action.clearing", "Clearing…")
            : ScheduledMaintenanceStrings.string("scheduled.action.clear", "Clear maintenance")
        return TSButton(variant: .ghost, size: .small, action: onClear) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: label)
            }
            .foregroundStyle(Color.TS.statusWarning)
        }
        .disabled(isMutating)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Scheduler block (web `!isActive` body)

/// The scheduler body — the native mirror of the web `!isActive` block: the explainer + "Schedule a
/// window" trigger, swapping to the inline schedule form once the operator opens it. This is the
/// surface's never-blank idle state.
struct ScheduledMaintenanceSchedulerView: View {
    @Binding var showSchedule: Bool
    @Binding var startDate: Date
    @Binding var durationText: String
    @Binding var message: String
    let isMutating: Bool
    let onSchedule: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if showSchedule {
                ScheduledMaintenanceFormView(
                    startDate: $startDate,
                    durationText: $durationText,
                    message: $message,
                    isMutating: isMutating,
                    onSchedule: onSchedule,
                    onCancel: onCancel
                )
            } else {
                explainer
                scheduleTrigger
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var explainer: some View {
        Text(verbatim: ScheduledMaintenanceStrings.string(
            "scheduled.explainer",
            "Schedule a window for upgrades or hardware moves. The status banner will switch to "
                + "blue “Maintenance” instead of red “Down”."
        ))
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var scheduleTrigger: some View {
        let label = ScheduledMaintenanceStrings.string("scheduled.scheduleWindow", "Schedule a window")
        return TSButton(
            variant: .ghost,
            size: .small,
            action: { showSchedule = true },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "calendar.badge.plus")
                        .font(.system(size: 12, weight: .semibold))
                        .accessibilityHidden(true)
                    Text(verbatim: label)
                }
            }
        )
        .accessibilityLabel(Text(verbatim: label))
    }
}
