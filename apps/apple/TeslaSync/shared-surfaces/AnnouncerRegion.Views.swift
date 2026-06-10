//
//  AnnouncerRegion.Views.swift
//  TeslaSync — P4 shared surface · 0001 · AnnouncerRegion (Apple)
//
//  The presentational subviews composed by `AnnouncerRegion`: the priority badge, the live
//  region card (the visible parity of one web `<VisuallyHidden liveRegion>`), the recent
//  history row + section, the data body, and the freshness chip (P4 connectivity axis). All
//  consume the P1/S10 facade and the shared P1/S9 tokens / components — no networking, no
//  Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Priority badge (web `priority` → live-region role)

/// A compact chip naming a message's urgency — `Polite` (queues) or `Assertive` (interrupts).
/// Decorative: the spoken priority lives on the row's combined accessibility label.
struct AnnouncerPriorityBadge: View {
    let priority: AnnouncerPriority

    private var tone: Color {
        priority.isInterrupting ? Color.TS.statusWarning : Color.TS.statusInfo
    }

    private var label: String {
        priority.isInterrupting
            ? AnnouncerRegionStrings.string("announcer.region.assertive", "Assertive")
            : AnnouncerRegionStrings.string("announcer.region.polite", "Polite")
    }

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.label)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Live region card (visible parity of one web `<VisuallyHidden liveRegion>`)

/// One live region rendered visibly — the polite or assertive region, with its name, the role
/// it plays, and its current message (or an em-dash when it has not been written to yet). The
/// whole card is one VoiceOver element whose label reads the region name then its message.
struct AnnouncerRegionCard: View {
    let priority: AnnouncerPriority
    let message: AnnouncerMessage?

    private var tone: Color {
        priority.isInterrupting ? Color.TS.statusWarning : Color.TS.statusInfo
    }

    private var systemImage: String {
        priority.isInterrupting ? "exclamationmark.bubble.fill" : "speaker.wave.2.fill"
    }

    private var regionName: String {
        priority.isInterrupting
            ? AnnouncerRegionStrings.string("announcer.region.assertive", "Assertive")
            : AnnouncerRegionStrings.string("announcer.region.polite", "Polite")
    }

    private var roleText: String {
        priority.isInterrupting
            ? AnnouncerRegionStrings.string("announcer.region.assertiveRole", "Interrupts VoiceOver")
            : AnnouncerRegionStrings.string("announcer.region.politeRole", "Waits for VoiceOver to finish")
    }

    private var emptyValue: String {
        AnnouncerRegionStrings.string("announcer.region.emptyValue", "—")
    }

    private var accessibilityLabelText: String {
        AnnouncerRegionAccessibility.regionLabel(
            regionName: regionName,
            message: message?.text ?? "",
            emptyWord: AnnouncerRegionStrings.string("announcer.region.emptyA11y", "no announcement yet")
        )
    }

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                header
                Text(verbatim: message?.text ?? emptyValue)
                    .font(Font.TS.body)
                    .foregroundStyle(message == nil ? Color.TS.textMuted : Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 14))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            Text(verbatim: regionName)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: roleText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - History row (one recent announcement)

/// One recent-announcement row — the priority badge, the message, and a relative timestamp.
/// The whole row is one VoiceOver element whose label reads the priority then the message.
struct AnnouncerHistoryRow: View {
    let message: AnnouncerMessage

    private var priorityWord: String {
        message.priority.isInterrupting
            ? AnnouncerRegionStrings.string("announcer.region.assertive", "Assertive")
            : AnnouncerRegionStrings.string("announcer.region.polite", "Polite")
    }

    private var accessibilityLabelText: String {
        AnnouncerRegionAccessibility.historyLabel(priorityWord: priorityWord, message: message.text)
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            AnnouncerPriorityBadge(priority: message.priority)
            Text(verbatim: message.text)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: TSSpacing.sm)
            Text(message.timestamp, style: .relative)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}

// MARK: - History section (the recent-announcement log)

/// The recent-announcement log — a titled card listing the most-recent rows, divider
/// separated. The depth that keeps the surface a meaningful inspector rather than two bare
/// regions.
struct AnnouncerHistorySection: View {
    let entries: [AnnouncerMessage]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: AnnouncerRegionStrings.string("announcer.history.title", "Recent announcements"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)

            TSCard {
                VStack(spacing: 0) {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, message in
                        if index > 0 {
                            Divider().overlay(Color.TS.border)
                        }
                        AnnouncerHistoryRow(message: message)
                            .padding(.vertical, TSSpacing.sm)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Data body (two regions + recent history)

/// The data render — the two live region cards (the web polite + assertive siblings) over the
/// recent-announcement log, wrapped in the shared fade-in for entrance polish.
struct AnnouncerDataView: View {
    let resolved: AnnouncerRegionResolved

    private var recent: [AnnouncerMessage] {
        Array(resolved.entries.prefix(10))
    }

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                AnnouncerRegionCard(priority: .polite, message: resolved.polite)
                AnnouncerRegionCard(priority: .assertive, message: resolved.assertive)
                if !recent.isEmpty {
                    AnnouncerHistorySection(entries: recent)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the body when the feed is not live — a coloured dot + a
/// label (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request
/// the snapshot, with an explicit label.
struct AnnouncerFreshnessChip: View {
    let connection: AnnouncerConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: AnnouncerRegionStrings.string("announcer.live", "Live")
        case .stale: AnnouncerRegionStrings.string("announcer.stale", "Stale")
        case .offline: AnnouncerRegionStrings.string("announcer.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            AnnouncerRegionStrings.string("announcer.staleA11y", "Stale — tap to refresh")
        case .offline:
            AnnouncerRegionStrings.string("announcer.offlineA11y", "Offline — showing last known announcements")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
