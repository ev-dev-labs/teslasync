//
//  VersionSegment.Views.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  The presentational subviews composed by ``VersionSegment`` for its data render: the ready segment
//  button (the native parity of the web status-bar button — the Tag glyph, the `v{appVersion}` label,
//  the `· {sha}` clause, and the amber "update" / cyan "unseen changelog" dot, with the web tooltip as a
//  native `.help` and the web `aria-label` as the VoiceOver label) and the freshness chip (P4
//  connectivity axis, shown in the modal). All consume the P1/S10 facade + the shared P1/S9 tokens — no
//  networking, no Tailwind ports, no raw hex.
//
//  Accessibility note: the segment is one focusable button whose VoiceOver label is the web `aria-label`
//  (version + SHA + unseen) and whose value announces "Update available" when an update is pending (the
//  web update-dot's own `aria-label`); the glyph + dot are decorative (web `aria-hidden`).
//

import SwiftUI

// MARK: - Ready segment (web status-bar button)

/// The ready segment — the data render of the surface. Reproduces the web button exactly: the Tag glyph,
/// the `v{appVersion}` label + optional `· {sha}` (web `sha && sha !== 'dev'`), and the update/unseen
/// dot. Tapping opens the "About this build" modal (web `onClick={() => setOpen(true)}`). Honours the
/// web `iconOnly` prop.
struct VersionSegmentReadyView: View {
    let data: VersionSegmentData
    let iconOnly: Bool
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "tag")
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                if !iconOnly {
                    Text(verbatim: "v\(data.appVersion)")
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textSecondary)
                    if data.hasSHA {
                        Text(verbatim: "· \(data.sha)")
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
                dot
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surfaceGlass, in: Capsule())
        }
        .buttonStyle(.plain)
        .help(Text(verbatim: tooltip))
        .accessibilityLabel(Text(verbatim: ariaLabel))
        .accessibilityValue(Text(verbatim: accessibilityValue))
        .accessibilityHint(Text(verbatim: VersionSegmentStrings.string(
            "statusBar.version.openHint", "Opens build details"
        )))
        .accessibilityAddTraits(.isButton)
    }

    // MARK: Dot (web amber update / cyan unseen)

    @ViewBuilder
    private var dot: some View {
        switch data.dot {
        case .update:
            Circle().fill(Color.TS.statusWarning).frame(width: 6, height: 6).accessibilityHidden(true)
        case .unseenChangelog:
            Circle().fill(Color.TS.accent).frame(width: 6, height: 6).accessibilityHidden(true)
        case .none:
            EmptyView()
        }
    }

    // MARK: Tooltip (web `<Tooltip content>` row)

    private var tooltip: String {
        let versionLabel = VersionSegmentStrings.string("statusBar.version.tooltip", "TeslaSync version")
        var parts = [versionLabel, "v\(data.appVersion)"]
        if data.hasSHA {
            parts.append(data.sha)
        }
        if let uptime = data.uptimeLabel {
            let template = VersionSegmentStrings.string("statusBar.version.uptime", "up {{uptime}}")
            parts.append(template.replacingOccurrences(of: "{{uptime}}", with: uptime))
        }
        if data.hasUnseenChangelog {
            parts.append(unseenHint)
        }
        return VersionSegmentAccessibility.tooltip(parts: parts)
    }

    // MARK: VoiceOver (web `aria-label` + update-dot label)

    private var ariaLabel: String {
        let versionLabel = VersionSegmentStrings.string("statusBar.version.aria", "TeslaSync version")
        let unseen = data.hasUnseenChangelog
            ? VersionSegmentStrings.string("changelog.unseenAria", "unseen changelog")
            : nil
        return VersionSegmentAccessibility.segmentLabel(
            versionLabel: versionLabel,
            appVersion: data.appVersion,
            sha: data.sha,
            hasSHA: data.hasSHA,
            unseenLabel: unseen
        )
    }

    private var accessibilityValue: String {
        data.updateAvailable
            ? VersionSegmentStrings.string("statusBar.version.updateAvailable", "Update available")
            : ""
    }

    private var unseenHint: String {
        let template = VersionSegmentStrings.string("changelog.unseenHint", "{{count}} new release(s)")
        return template.replacingOccurrences(of: "{{count}}", with: String(data.unseenChangelogCount))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown in the modal when the version feed is not live — a coloured dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the probe, with an
/// explicit label.
struct VersionSegmentFreshnessChip: View {
    let connection: VersionSegmentConnection
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
        case .live: VersionSegmentStrings.string("statusBar.version.live", "Live")
        case .stale: VersionSegmentStrings.string("statusBar.version.stale", "Stale")
        case .offline: VersionSegmentStrings.string("statusBar.version.offline", "Offline")
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live:
            label
        case .stale:
            VersionSegmentStrings.string("statusBar.version.staleA11y", "Version info is stale — tap to refresh")
        case .offline:
            VersionSegmentStrings.string("statusBar.version.offlineA11y", "Offline — showing the last known version")
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
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}
