//
//  VersionSegment.Modal.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  The "About this build" modal content composed by ``VersionSegment`` — the native parity of the web
//  modal body: the version-provenance list (web `<dl>` — App version / Commit always, then Helm chart /
//  Go runtime / Platform / Server uptime under the same presence guards), the amber "newer release"
//  banner (web `updateAvailable` block, with the optional `latest` + `message`), the P4 freshness chip,
//  and the three actions (What's new / Release notes / Close). All copy resolves through the P1/S10
//  facade; all colour comes from the P1/S9 tokens; the values come pre-derived from
//  ``VersionSegmentData`` so the modal is a pure function of it.
//

import SwiftUI

// MARK: - Modal content (web "About this build")

/// The modal body — a pure function of the resolved ``VersionSegmentData`` + the connection axis. Renders
/// the provenance rows, the optional update banner, the freshness chip, and the action row.
struct VersionSegmentModalContent: View {
    let data: VersionSegmentData
    let connection: VersionSegmentConnection
    let onOpenChangelog: () -> Void
    let onOpenReleaseNotes: () -> Void
    let onClose: () -> Void
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            provenance
            if data.updateAvailable {
                updateBanner
            }
            if connection != .live {
                VersionSegmentFreshnessChip(connection: connection, onRefresh: onRefresh)
            }
            actions
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    // MARK: Provenance list (web `<dl>`)

    private var provenance: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(data.provenanceRows) { row in
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
                    Text(verbatim: VersionSegmentStrings.string(row.labelKey, row.labelFallback))
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                    Spacer(minLength: TSSpacing.md)
                    if row.mono {
                        TSCode(row.value)
                    } else {
                        Text(verbatim: row.value)
                            .font(Font.TS.body)
                            .foregroundStyle(Color.TS.textPrimary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    // MARK: Update banner (web `updateAvailable` block)

    private var updateBanner: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: updateBannerTitle)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.statusWarning)
            if let message = data.updateMessage {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusWarning.opacity(0.10),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.30), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private var updateBannerTitle: String {
        let base = VersionSegmentStrings.string("statusBar.version.updateBanner", "A newer release is available")
        if let latest = data.latestVersion {
            return "\(base): v\(latest)"
        }
        return base
    }

    // MARK: Actions (web button row)

    private var actions: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            whatsNewButton
            TSButton(variant: .ghost, size: .small, action: onOpenReleaseNotes) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.up.right.square").accessibilityHidden(true)
                    Text(verbatim: releaseNotesLabel)
                }
            }
            .accessibilityLabel(Text(verbatim: releaseNotesLabel))
            TSButton(variant: .primary, size: .small, action: onClose) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "xmark").accessibilityHidden(true)
                    Text(verbatim: closeLabel)
                }
            }
            .accessibilityLabel(Text(verbatim: closeLabel))
        }
    }

    private var whatsNewButton: some View {
        TSButton(variant: .ghost, size: .small, action: onOpenChangelog) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "sparkles").accessibilityHidden(true)
                Text(verbatim: whatsNewLabel)
                if data.hasUnseenChangelog {
                    Circle().fill(Color.TS.accent).frame(width: 6, height: 6).accessibilityHidden(true)
                }
            }
        }
        .accessibilityLabel(Text(verbatim: whatsNewLabel))
    }

    private var whatsNewLabel: String {
        VersionSegmentStrings.string("changelog.openModal", "What's new")
    }

    private var releaseNotesLabel: String {
        VersionSegmentStrings.string("statusBar.version.changelog", "Release notes")
    }

    private var closeLabel: String {
        VersionSegmentStrings.string("statusBar.version.close", "Close")
    }
}
