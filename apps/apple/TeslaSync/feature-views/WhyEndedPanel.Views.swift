//
//  WhyEndedPanel.Views.swift
//  TeslaSync — P4 feature view · 0152 · WhyEndedPanel (Apple)
//
//  The presentational subviews composed by `WhyEndedPanel`: the two diagnostic
//  sections (FSM-transition timeline + the adaptive, paginated signal table), the
//  loading / error states, and the freshness chip + connectivity banner (native
//  HIG chrome). All consume the P1/S10 facade + the shared P1/S9 tokens / shared
//  components — no networking, no Tailwind ports.
//
//  • Web `Timeline` → a hand-rolled connected timeline (mono `fsm: from → to`
//    title, localized `trigger: …` subtitle, absolute time, accent node).
//  • Web `DataTable` (Timestamp / Field / Value, pagination 25/[25,50,100],
//    mobileColumns) → a columnar SwiftUI `Grid` on macOS / regular width and a
//    card list on compact iPhone width, with a page-size + prev/next pager.
//  • Web `EmptyState` (FSM empty / error+retry) + `DataTable` emptyMessage →
//    `TSEmptyState`; web `Spinner` → `TSSpinner`.
//

import SwiftUI

// MARK: - Section header (web icon + `PanelTitle`)

/// A diagnostic section header: a muted leading glyph + the panel-title heading,
/// mirroring the web `<Icon /> <PanelTitle>` rows.
struct WhyEndedSectionHeader: View {
    let systemImage: String
    let title: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - FSM transitions section (web GitBranch + Timeline)

/// The "FSM transitions" section: the header + either the web `EmptyState`
/// ("No transitions in window") or the connected transition timeline.
struct WhyEndedTransitionsSection: View {
    let model: WhyEndedPanelModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            WhyEndedSectionHeader(systemImage: "arrow.triangle.branch", title: WhyEndedPanelStrings.fsmTitle)
            if model.projection.transitions.isEmpty {
                TSEmptyState(
                    title: "\(WhyEndedPanelStrings.fsmEmptyTitle)",
                    message: "\(WhyEndedPanelStrings.fsmEmptyMessage)",
                    systemImage: "arrow.triangle.branch"
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, TSSpacing.sm)
            } else {
                WhyEndedTimeline(rows: model.projection.transitions)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: WhyEndedPanelStrings.fsmSectionA11y))
    }
}

/// The connected FSM-transition timeline (web `Timeline`): one row per transition,
/// newest at the top, with a connecting rail between accent nodes.
struct WhyEndedTimeline: View {
    let rows: [WhyEndedTransitionRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { offset, row in
                WhyEndedTimelineRow(row: row, isLast: offset == rows.count - 1)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// One timeline row (web timeline item): the accent node + connector rail, the
/// monospaced `fsm: from → to` title with a trailing absolute timestamp, and the
/// localized `trigger: …` subtitle.
struct WhyEndedTimelineRow: View {
    let row: WhyEndedTransitionRow
    let isLast: Bool

    private var subtitle: String {
        WhyEndedPanelFormat.interpolateTrigger(
            template: WhyEndedPanelStrings.triggerTemplate,
            trigger: row.triggerValue == WhyEndedPanelFormat.emDash ? "" : row.triggerValue
        )
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(spacing: 0) {
                Circle().fill(Color.TS.accent).frame(width: 10, height: 10)
                if !isLast {
                    Rectangle().fill(Color.TS.border).frame(width: 2).frame(maxHeight: .infinity)
                }
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                    Text(verbatim: row.title)
                        .font(.system(.callout, design: .monospaced))
                        .foregroundStyle(Color.TS.textPrimary)
                    Spacer(minLength: TSSpacing.sm)
                    Text(verbatim: row.timestampText)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                        .fixedSize()
                }
                Text(verbatim: subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.bottom, isLast ? 0 : TSSpacing.md)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: WhyEndedPanelAccessibility.transitionRowLabel(for: row, subtitle: subtitle)))
    }
}

// MARK: - Signal window section (web Radio + DataTable)

/// The "Signal window" section: the header + either the web `DataTable`
/// emptyMessage ("No signals in this window…") or the adaptive, paginated table.
struct WhyEndedSignalSection: View {
    let model: WhyEndedPanelModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            WhyEndedSectionHeader(
                systemImage: "dot.radiowaves.left.and.right",
                title: WhyEndedPanelStrings.signalTitle
            )
            if model.projection.signals.isEmpty {
                TSEmptyState(
                    title: "\(WhyEndedPanelStrings.signalEmpty)",
                    systemImage: "dot.radiowaves.left.and.right"
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, TSSpacing.sm)
            } else {
                WhyEndedSignalTable(model: model)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: WhyEndedPanelStrings.signalSectionA11y))
        .accessibilityValue(Text(verbatim: WhyEndedPanelAccessibility.signalCountSummary(
            model.projection.signals.count,
            format: WhyEndedPanelStrings.signalCountFormat
        )))
    }
}

// MARK: - Loading (web `Spinner`)

/// The expanded body's initial-fetch loader (web centered `Spinner`).
struct WhyEndedLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, TSSpacing.x2xl)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: WhyEndedPanelStrings.loadingA11y))
    }
}

// MARK: - Error (web `EmptyState` + Retry action)

/// The query-failure state (web `EmptyState` titled "Could not load diagnostic"
/// with the error message or the fallback, plus a Retry action wired to refetch).
struct WhyEndedErrorView: View {
    let message: String
    let onRetry: () -> Void

    private var displayMessage: String {
        message.isEmpty ? WhyEndedPanelStrings.errorMessage : message
    }

    var body: some View {
        TSEmptyState(
            title: "\(WhyEndedPanelStrings.errorTitle)",
            message: "\(displayMessage)",
            systemImage: "stethoscope"
        ) {
            Button(action: onRetry) {
                Text(verbatim: WhyEndedPanelStrings.retry)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: WhyEndedPanelStrings.retry))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
    }
}

// MARK: - Freshness chip + connectivity banner (native HIG chrome)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct WhyEndedFreshnessChip: View {
    let connection: WhyEndedPanelConnection

    private var descriptor: (tone: Color, label: String) {
        switch connection {
        case .live: (Color.TS.statusSuccess, WhyEndedPanelStrings.live)
        case .stale: (Color.TS.statusWarning, WhyEndedPanelStrings.stale)
        case .offline: (Color.TS.textMuted, WhyEndedPanelStrings.offline)
        }
    }

    var body: some View {
        let descriptor = descriptor
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: descriptor.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: descriptor.label))
    }
}

/// The stale / offline banner shown above the expanded body when the bound source
/// is not live, so cached diagnostic rows are clearly labeled.
struct WhyEndedConnectivityBanner: View {
    let connection: WhyEndedPanelConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: isOffline ? WhyEndedPanelStrings.offlineBanner : WhyEndedPanelStrings.staleBanner)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
