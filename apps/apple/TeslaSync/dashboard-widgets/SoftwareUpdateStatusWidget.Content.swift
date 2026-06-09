//
//  SoftwareUpdateStatusWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0092 · SoftwareUpdateStatusWidget (Apple)
//
//  The content-phase body of the surface: the compact (cols ≤ 1 && rows ≤ 1)
//  version + status tile and the standard current-version row + update section
//  (target version, download/install progress bar, ready message, estimate, and
//  schedule), plus the progress-bar / status-chip / info-row building blocks.
//  Split from SoftwareUpdateStatusWidget.swift to keep each file focused.
//

import Foundation
import SwiftUI

// MARK: - Content body (compact + standard layouts)

extension SoftwareUpdateStatusWidget {
    @ViewBuilder
    var contentBody: some View {
        if isCompact {
            compactContent
        } else {
            standardContent
        }
    }

    /// ── Compact: version + status chip (web `CompactView`) ──
    private var compactContent: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "laptopcomputer.and.iphone")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: projection.currentVersion)
                .font(Font.TS.bodySm)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            SoftwareStatusBadgeChip(badge: projection.statusBadge)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: SoftwareStatusAccessibility.summary(for: projection)))
    }

    /// ── Standard: current version row + update section (web `FullView`) ──
    private var standardContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if connection != .live { connectivityBanner }
                currentVersionRow
                if projection.showsUpdateSection { updateSection }
                if projection.stage == .upToDate { upToDateRow }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SoftwareStatusAccessibility.summary(for: projection)))
    }

    /// Web current-version row: label + bold version on the left, status chip right.
    private var currentVersionRow: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                SoftwareStatusStrings.text("widget.currentVersion", "Current Version")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: projection.currentVersion)
                    .font(Font.TS.bodySm)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            SoftwareStatusBadgeChip(badge: projection.statusBadge)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// Web update section — the target version, the active progress bar (or ready
    /// message), and (tall layout) the estimate + schedule rows.
    private var updateSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if let updateVersion = projection.updateVersion {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.down.circle")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    SoftwareStatusStrings.text("widget.updateAvailable", "Update")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    Text(verbatim: updateVersion)
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.accent)
                        .lineLimit(1)
                }
                .accessibilityElement(children: .combine)
            }

            if let progress = projection.progress {
                SoftwareStatusProgressBar(progress: progress)
            } else if projection.stage == .ready {
                readyToInstallRow
            }

            if isTall, let estimate = projection.expectedDurationText {
                SoftwareStatusInfoRow(systemImage: "clock", text: estimateText(estimate), topDivider: true)
            }

            if isTall, let scheduled = projection.scheduledStart {
                SoftwareStatusInfoRow(systemImage: "clock", text: scheduledText(scheduled), topDivider: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web ready-to-install confirmation (emerald check).
    private var readyToInstallRow: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            SoftwareStatusStrings.text("widget.readyToInstall", "Ready to install")
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.statusSuccess)
        .accessibilityElement(children: .combine)
    }

    /// Web up-to-date confirmation (emerald check), shown when no update exists.
    private var upToDateRow: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            SoftwareStatusStrings.text("widget.upToDate", "Up to date")
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.statusSuccess)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// Web `Est. time: ~{n} min` (composed through the i18n facade).
    private func estimateText(_ durationText: String) -> String {
        let label = SoftwareStatusStrings.string("widget.estimatedTime", "Est. time")
        let unit = SoftwareStatusStrings.string("widget.minutes", "min")
        return "\(label): \(durationText) \(unit)"
    }

    /// Web `Scheduled: {scheduledStart}` (composed through the i18n facade).
    private func scheduledText(_ scheduled: String) -> String {
        let label = SoftwareStatusStrings.string("widget.scheduledStart", "Scheduled")
        return "\(label): \(scheduled)"
    }
}

// MARK: - SoftwareStatusProgressBar (web `MetricBar`: label + coloured readout + fill)

/// The download / install proportion bar (web `MetricBar`). The label row
/// reproduces the web header (title left, flow-coloured percent right); the capsule
/// fill uses the flow's design-token colour.
struct SoftwareStatusProgressBar: View {
    let progress: SoftwareStatusProgress

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: SoftwareStatusStrings.resolve(progress.label))
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: progress.percentText)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(progress.kind.color)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.TS.border.opacity(0.3))
                    Capsule()
                        .fill(progress.kind.color)
                        .frame(width: geo.size.width * min(max(progress.fraction, 0), 1))
                }
            }
            .frame(height: 8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(SoftwareStatusStrings.resolve(progress.label)): \(progress.percentText)")
        )
    }
}

// MARK: - SoftwareStatusBadgeChip (web `<Badge variant size="sm" dot>`)

/// A compact tinted status chip with a leading state dot (web `Badge … dot`),
/// styled with the shared tone tokens. Resolves the localized label through the
/// P1/S10 facade — the shared `TSBadge` takes only a `LocalizedStringKey` (default
/// catalog table), so it can't resolve this surface's per-table key.
struct SoftwareStatusBadgeChip: View {
    let badge: SoftwareStatusBadge

    var body: some View {
        let tone = badge.variant.tone
        let label = SoftwareStatusStrings.resolve(badge.label)
        return HStack(spacing: 4) {
            Circle().fill(tone.color).frame(width: 5, height: 5)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(tone.color)
                .lineLimit(1)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - SoftwareStatusInfoRow (web clock estimate / schedule row)

/// A muted icon + caption row (web's `Clock` estimate / schedule lines), with an
/// optional hairline top divider matching the web `border-t`.
struct SoftwareStatusInfoRow: View {
    let systemImage: String
    let text: String
    var topDivider: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if topDivider {
                Rectangle()
                    .fill(Color.TS.border.opacity(0.5))
                    .frame(height: 1)
                    .accessibilityHidden(true)
            }
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: systemImage)
                    .font(.system(size: 10, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: text)
                    .font(Font.TS.caption)
                    .lineLimit(1)
            }
            .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}
