//
//  BackgroundWorkSegment.Views.swift
//  TeslaSync — P4 shared surface · 0177 · BackgroundWorkSegment (Apple)
//
//  The presentational subviews composed by ``BackgroundWorkSegment`` for its active render: the segment
//  button (the native parity of the web status-bar button — the spinning loader, the task-count summary,
//  the amber tint, the web tooltip as a native `.help` and the web `aria-label` as the VoiceOver label),
//  the running-jobs popover (the web `role="dialog"` listing — the "Running" heading, the per-kind glyph,
//  the job label + description, and a trailing spinner), and the freshness chip (P4 connectivity axis,
//  shown in the popover). All consume the P1/S10 facade + the shared P1/S9 tokens — no networking, no
//  Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Small spinner (web Loader2 animate-spin)

/// The compact spinning loader — the native peer of the web `<Loader2 className="animate-spin">`. Uses the
/// system `ProgressView` (HIG-idiomatic indeterminate spinner) tinted amber; decorative for VoiceOver.
struct BackgroundWorkSpinner: View {
    var tint: Color = .TS.statusWarning

    var body: some View {
        ProgressView()
            .progressViewStyle(.circular)
            .controlSize(.small)
            .tint(tint)
            .accessibilityHidden(true)
    }
}

// MARK: - Active segment (web status-bar button + popover)

/// The active segment — the data render of the surface. Reproduces the web button exactly: the spinning
/// loader, the `{summary}` task-count label (hidden when `iconOnly`), and the amber tint. Tapping toggles
/// the running-jobs popover (web `onClick={() => setOpen((o) => !o)}`).
struct BackgroundWorkActiveView: View {
    let data: BackgroundWorkData
    let iconOnly: Bool
    let connection: BackgroundWorkConnection
    @Binding var isPopoverPresented: Bool
    let onToggle: () -> Void
    let onRefresh: () -> Void

    private var summary: String {
        BackgroundWorkSummary.text(count: data.count, resolve: BackgroundWorkStrings.string)
    }

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: TSSpacing.xs) {
                BackgroundWorkSpinner()
                if !iconOnly {
                    Text(verbatim: summary)
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.statusWarning)
                }
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surfaceGlass, in: Capsule())
        }
        .buttonStyle(.plain)
        .help(Text(verbatim: tooltip))
        .accessibilityLabel(Text(verbatim: ariaLabel))
        .accessibilityHint(Text(verbatim: BackgroundWorkStrings.string(
            "statusBar.background.openHint", "Opens the list of running tasks"
        )))
        .accessibilityAddTraits(.isButton)
        .popover(isPresented: $isPopoverPresented) {
            BackgroundWorkPopoverContent(data: data, connection: connection, onRefresh: onRefresh)
        }
    }

    private var tooltip: String {
        let prefix = BackgroundWorkStrings.string("statusBar.background.tooltip", "Background work in progress")
        return BackgroundWorkAccessibility.tooltip(prefix: prefix, summary: summary)
    }

    private var ariaLabel: String {
        let aria = BackgroundWorkStrings.string("statusBar.background.aria", "Background tasks")
        return BackgroundWorkAccessibility.segmentLabel(aria: aria, summary: summary)
    }
}

// MARK: - Popover content (web `role="dialog"` running-jobs list)

/// The running-jobs popover — the native parity of the web `<div role="dialog">`: the uppercase "Running"
/// heading, the P4 freshness chip (when not live), and one row per in-flight job. A pure function of the
/// resolved ``BackgroundWorkData`` + the connection axis.
struct BackgroundWorkPopoverContent: View {
    let data: BackgroundWorkData
    let connection: BackgroundWorkConnection
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: heading)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            if connection != .live {
                BackgroundWorkFreshnessChip(connection: connection, onRefresh: onRefresh)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    ForEach(data.jobs) { job in
                        BackgroundWorkJobRow(job: job)
                    }
                }
            }
            .frame(maxHeight: 280)
        }
        .padding(TSSpacing.sm)
        .frame(minWidth: 240, maxWidth: 320, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: BackgroundWorkStrings.string(
            "statusBar.background.aria", "Background tasks"
        )))
    }

    private var heading: String {
        BackgroundWorkStrings.string("statusBar.background.heading", "Running")
    }
}

// MARK: - Job row (web popover row)

/// One running-job row — the native parity of the web popover row: the per-kind glyph, the job label + an
/// optional secondary line, and a trailing spinner. The kind glyph is decorative; the spoken label names
/// the kind so VoiceOver users still get the category.
struct BackgroundWorkJobRow: View {
    let job: BackgroundJob

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: job.kind.systemImage)
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: job.label)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                if let description = job.description {
                    Text(verbatim: description)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            BackgroundWorkSpinner()
        }
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        let kind = BackgroundWorkStrings.string(job.kind.accessibilityKey, job.kind.accessibilityFallback)
        var label = "\(kind): \(job.label)"
        if let description = job.description {
            label += ". \(description)"
        }
        return label
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown in the popover when the job feed is not live — a coloured dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the feed, with an
/// explicit label.
struct BackgroundWorkFreshnessChip: View {
    let connection: BackgroundWorkConnection
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
        case .live: BackgroundWorkStrings.string("statusBar.background.live", "Live")
        case .stale: BackgroundWorkStrings.string("statusBar.background.stale", "Stale")
        case .offline: BackgroundWorkStrings.string("statusBar.background.offline", "Offline")
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live:
            label
        case .stale:
            BackgroundWorkStrings.string("statusBar.background.staleA11y", "Background work is stale — tap to refresh")
        case .offline:
            BackgroundWorkStrings.string("statusBar.background.offlineA11y", "Offline — showing the last known tasks")
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
