//
//  OnboardingChecklistWidget.Components.swift
//  TeslaSync — P4 dashboard widget · 0071 · OnboardingChecklistWidget (Apple)
//
//  The surface's composable sub-views — progress header, task row, completion
//  footer, freshness chip, connectivity banner, and loading skeleton. All copy
//  resolves through the P1/S10 facade; all styling uses the P1/S9 design tokens.
//

import SwiftUI

// MARK: - Progress header (web progress bar + "{done}/{total} complete")

/// The progress header: the `{done}/{total} complete` label, the percentage, and
/// a gradient-filled bar (emerald→cyan once complete, cyan→blue while in
/// progress). Exposes a single VoiceOver value for the whole control.
struct ChecklistProgressBar: View {
    let projection: ChecklistProjection

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: progressLabel)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: percentLabel)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
            }
            track
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: OnboardingChecklistAccessibility.progressLabel(projection)))
    }

    private var track: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.5))
                Capsule()
                    .fill(fillGradient)
                    .frame(width: max(0, geo.size.width * CGFloat(projection.progressPercent) / 100))
            }
        }
        .frame(height: 6)
    }

    private var fillGradient: LinearGradient {
        let colors = projection.allComplete
            ? [Color.TS.statusSuccess, Color.TS.accent]
            : [Color.TS.accent, Color.TS.chartSeriesSpeed]
        return LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing)
    }

    private var progressLabel: String {
        OnboardingChecklistStrings.formatted(
            "widget.checklist.progress",
            "%1$lld/%2$lld complete",
            projection.completeCount,
            projection.totalCount
        )
    }

    private var percentLabel: String {
        OnboardingChecklistStrings.formatted("widget.checklist.percent", "%lld%%", projection.progressPercent)
    }
}

// MARK: - Task row (web checklist `<li>`)

/// One checklist step: completion glyph, icon box, title + description, and a CTA
/// for incomplete steps. Completed rows dim, strike through their title, and drop
/// the CTA — faithful to the web row.
struct ChecklistTaskRow: View {
    let task: ChecklistTaskView
    let onActivate: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            summary
            Spacer(minLength: TSSpacing.xs)
            if !task.complete { ctaButton }
        }
        .padding(TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .opacity(task.complete ? 0.6 : 1)
    }

    private var summary: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: task.complete ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 15))
                .foregroundStyle(task.complete ? Color.TS.statusSuccess : Color.TS.textMuted)
            iconBox
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: title)
                    .strikethrough(task.complete)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(task.complete ? Color.TS.textSecondary : Color.TS.textPrimary)
                    .lineLimit(1)
                Text(verbatim: detail)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(2)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: summaryA11y))
    }

    private var iconBox: some View {
        Image(systemName: task.systemImage)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Color.TS.textSecondary)
            .frame(width: 28, height: 28)
            .background(
                Color.TS.textMuted.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .accessibilityHidden(true)
    }

    private var ctaButton: some View {
        Button(action: onActivate) {
            HStack(spacing: 2) {
                Text(verbatim: cta)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                Image(systemName: "arrow.right")
                    .font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(Color.TS.accent)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: "\(cta), \(title)"))
    }

    private var title: String {
        OnboardingChecklistStrings.string(task.titleKey, task.titleFallback)
    }

    private var detail: String {
        OnboardingChecklistStrings.string(task.descriptionKey, task.descriptionFallback)
    }

    private var cta: String {
        OnboardingChecklistStrings.string(task.ctaKey, task.ctaFallback)
    }

    private var summaryA11y: String {
        let status = task.complete
            ? OnboardingChecklistStrings.string("widget.checklist.taskComplete", "Completed")
            : OnboardingChecklistStrings.string("widget.checklist.taskIncomplete", "Not started")
        return "\(title). \(detail). \(status)"
    }
}

// MARK: - Completion footer (web celebratory banner)

/// The 100 %-complete banner: a celebratory message and a dismiss affordance.
struct ChecklistCompletionFooter: View {
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "sparkles")
                .font(.system(size: 14))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            Text(verbatim: OnboardingChecklistStrings.string("checklist.completeMessage", "You're all set! 🎉"))
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.statusSuccess)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.xs)
            Button(action: onDismiss) {
                HStack(spacing: 2) {
                    Image(systemName: "arrow.counterclockwise").font(.system(size: 10, weight: .semibold))
                    Text(verbatim: dismissLabel).font(Font.TS.caption)
                }
                .foregroundStyle(Color.TS.textSecondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: dismissLabel))
        }
        .padding(TSSpacing.sm)
        .background(
            Color.TS.statusSuccess.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusSuccess.opacity(0.25), lineWidth: 1)
        )
    }

    private var dismissLabel: String {
        OnboardingChecklistStrings.string("checklist.dismiss", "Dismiss")
    }
}

// MARK: - Freshness chip (native chrome)

/// The header freshness chip — a dot + Live / Stale / Offline label (ADR-013).
struct ChecklistFreshnessChip: View {
    let connection: ChecklistConnection

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: OnboardingChecklistStrings.string("widget.checklist.live", "Live")
        case .stale: OnboardingChecklistStrings.string("widget.checklist.stale", "Stale")
        case .offline: OnboardingChecklistStrings.string("widget.checklist.offline", "Offline")
        }
    }
}

// MARK: - Connectivity banner (native chrome)

/// The stale / offline banner shown above cached content (ADR-013).
struct ChecklistConnectivityBanner: View {
    let connection: ChecklistConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: message).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var isOffline: Bool {
        connection == .offline
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: String {
        isOffline
            ? OnboardingChecklistStrings.string(
                "widget.checklist.offlineBanner",
                "Offline — showing your last saved progress"
            )
            : OnboardingChecklistStrings.string(
                "widget.checklist.staleBanner",
                "Reconnecting — your progress may be out of date"
            )
    }
}

// MARK: - Loading skeleton (native chrome)

/// The first-fetch skeleton — a progress shimmer over three row shimmers.
struct ChecklistLoadingChrome: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 120, height: 10)
            TSSkeleton(height: 6, cornerRadius: TSRadius.pill)
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.pill)
                    TSSkeleton(width: 28, height: 28, cornerRadius: TSRadius.sm)
                    VStack(alignment: .leading, spacing: 4) {
                        TSSkeleton(height: 10)
                        TSSkeleton(width: 140, height: 8)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(OnboardingChecklistStrings.text("widget.checklist.loading", "Loading setup checklist"))
    }
}
