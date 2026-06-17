//
//  GuardModeTimelineView.swift
//  TeslaSync — P4 feature view · P7 · GuardMode (Apple) — Row 4 (Timeline)
//
//  The guard event timeline (web GlassPanel 6) and its per-event row. Each row
//  reproduces the web `EventRow`: a tone-coded badge, timestamp, optional
//  from→to state, the acknowledger, and an Ack action for open events. An empty
//  feed shows a `ContentUnavailableView` rather than a blank panel.
//

import SwiftUI

/// The event timeline panel (web GlassPanel 6).
struct GuardModeTimelinePanel: View {
    let events: [GuardModeEvent]
    let unacknowledgedCount: Int
    let isAcknowledging: Bool
    let onAcknowledge: (Int64) -> Void

    var body: some View {
        GuardModeCard {
            VStack(alignment: .leading, spacing: 14) {
                header
                if events.isEmpty {
                    ContentUnavailableView {
                        Label(
                            String(localized: "translation.guard.noEvents", defaultValue: "No guard events yet"),
                            systemImage: "bell.slash"
                        )
                    }
                } else {
                    VStack(spacing: 10) {
                        ForEach(events) { event in
                            GuardModeEventRow(
                                event: event,
                                isAcknowledging: isAcknowledging,
                                onAcknowledge: onAcknowledge
                            )
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        HStack {
            GuardModeSectionTitle(
                text: String(localized: "translation.guard.eventTimeline", defaultValue: "Event Timeline")
            )
            if unacknowledgedCount > 0 {
                GuardModeBadge(text: unacknowledgedBadge, tone: .danger)
            }
        }
    }

    private var unacknowledgedBadge: String {
        let word = String(localized: "translation.guard.unack", defaultValue: "unacknowledged")
        return "\(unacknowledgedCount) \(word)"
    }
}

/// A single guard event row (web `EventRow`).
struct GuardModeEventRow: View {
    let event: GuardModeEvent
    let isAcknowledging: Bool
    let onAcknowledge: (Int64) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(acknowledged ? Color.secondary : tone.color)
                .frame(width: 22)
                .accessibilityHidden(true)
            details
            Spacer(minLength: 0)
            if !acknowledged {
                Button {
                    onAcknowledge(event.id)
                } label: {
                    Text(String(localized: "translation.guard.acknowledge", defaultValue: "Ack"))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(isAcknowledging)
            }
        }
        .padding(12)
        .background(rowBackground, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(rowBorder, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                GuardModeBadge(text: label, tone: tone)
                Text(event.ts.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if event.fromState != nil || event.toState != nil {
                Text("\(event.fromState ?? "—") → \(event.toState ?? "—")")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let acknowledgedBy = event.acknowledgedBy {
                Text("\(acknowledgedByLabel): \(acknowledgedBy)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var acknowledged: Bool { isGuardEventAcknowledged(event) }
    private var tone: GuardModeBadgeTone { GuardModeEventDisplay.tone(for: event.eventType) }
    private var label: String { GuardModeEventDisplay.label(for: event.eventType) }
    private var symbol: String {
        GuardModeEventDisplay.symbol(for: event.eventType, acknowledged: acknowledged)
    }

    private var rowBackground: Color { acknowledged ? Color.clear : Color.red.opacity(0.04) }
    private var rowBorder: Color {
        acknowledged ? Color.secondary.opacity(0.15) : Color.red.opacity(0.25)
    }

    private var acknowledgedByLabel: String {
        String(localized: "translation.guard.acknowledgedBy", defaultValue: "Acknowledged by")
    }
}
