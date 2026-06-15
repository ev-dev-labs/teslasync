//
//  RouteAnnouncer.Views.swift
//  TeslaSync — P4 shared surface · 0002 · RouteAnnouncer (Apple)
//
//  The presentational subviews composed by `RouteAnnouncer`: the live region card (the visible
//  parity of the web polite `<VisuallyHidden liveRegion>`), the recent-navigation row + section,
//  the data body, and the freshness chip (P4 connectivity axis). All consume the P1/S10 facade
//  and the shared P1/S9 tokens / components — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Live region card (visible parity of the web polite `<VisuallyHidden liveRegion>`)

/// The polite live region rendered visibly — its name, the role it plays, and the page title it
/// currently carries (or an em-dash when no navigation has been announced yet). The whole card is
/// one VoiceOver element whose label reads the region name then its current title.
struct RouteAnnouncerRegionCard: View {
    let announcement: RouteAnnouncement?

    private var accessibilityLabelText: String {
        RouteAnnouncerAccessibility.regionLabel(
            regionName: RouteAnnouncerStrings.regionName,
            title: announcement?.title ?? "",
            emptyWord: RouteAnnouncerStrings.emptyA11y
        )
    }

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                header
                Text(verbatim: announcement?.title ?? RouteAnnouncerStrings.emptyValue)
                    .font(Font.TS.body)
                    .foregroundStyle(announcement == nil ? Color.TS.textMuted : Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let path = announcement?.path, !path.isEmpty {
                    Text(verbatim: path)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "speaker.wave.2.fill")
                .font(.system(size: 14))
                .foregroundStyle(Color.TS.statusInfo)
                .accessibilityHidden(true)
            Text(verbatim: RouteAnnouncerStrings.regionName)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: RouteAnnouncerStrings.regionRole)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - History row (one recent navigation)

/// One recent-navigation row — the page title that was announced and a relative timestamp. The
/// whole row is one VoiceOver element whose label reads the navigation prefix then the title.
struct RouteAnnouncerHistoryRow: View {
    let announcement: RouteAnnouncement

    private var accessibilityLabelText: String {
        RouteAnnouncerAccessibility.historyLabel(
            navigatedWord: RouteAnnouncerStrings.navigatedWord,
            title: announcement.title
        )
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "arrow.turn.down.right")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: announcement.title)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if !announcement.path.isEmpty {
                    Text(verbatim: announcement.path)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            Text(announcement.timestamp, style: .relative)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}

// MARK: - History section (the recent-navigation log)

/// The recent-navigation log — a titled card listing the most-recent rows, divider separated.
/// The depth that keeps the surface a meaningful inspector rather than one bare region.
struct RouteAnnouncerHistorySection: View {
    let entries: [RouteAnnouncement]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: RouteAnnouncerStrings.historyTitle)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)

            TSCard {
                VStack(spacing: 0) {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, announcement in
                        if index > 0 {
                            Divider().overlay(Color.TS.border)
                        }
                        RouteAnnouncerHistoryRow(announcement: announcement)
                            .padding(.vertical, TSSpacing.sm)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Data body (live region + recent history)

/// The data render — the polite live region card over the recent-navigation log, wrapped in the
/// shared fade-in for entrance polish.
struct RouteAnnouncerDataView: View {
    let resolved: RouteAnnouncerResolved

    private var recent: [RouteAnnouncement] {
        Array(resolved.history.prefix(10))
    }

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                RouteAnnouncerRegionCard(announcement: resolved.current)
                if !recent.isEmpty {
                    RouteAnnouncerHistorySection(entries: recent)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the body when the feed is not live — a coloured dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the
/// snapshot, with an explicit label.
struct RouteAnnouncerFreshnessChip: View {
    let connection: RouteAnnouncerConnection
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
        case .live: RouteAnnouncerStrings.live
        case .stale: RouteAnnouncerStrings.stale
        case .offline: RouteAnnouncerStrings.offline
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live: RouteAnnouncerStrings.live
        case .stale: RouteAnnouncerStrings.staleA11y
        case .offline: RouteAnnouncerStrings.offlineA11y
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
