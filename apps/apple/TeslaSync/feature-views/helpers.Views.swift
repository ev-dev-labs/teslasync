//
//  helpers.Views.swift
//  TeslaSync — P4 feature view · 0245 · helpers (Apple)
//
//  The presentational subviews composed by `StatusHelpersPanel`: the status legend
//  (one row per sample — the SF Symbol from `kind`, the localized name, the badge
//  variant from `badgeKind`), the formatting reference (the ported `formatUptime` /
//  `formatBytes` shown on the bound samples), and the loading / empty / error chrome.
//  All consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no
//  Tailwind ports, no raw hex. The web helpers' literal hex (#22c55e / #f59e0b /
//  #ef4444 / #6b7280) maps to the semantic status tokens (ADR-006: semantic, not
//  literal) via `StatusKind.tone`.
//

import SwiftUI

// MARK: - Tone mapping (web hex → semantic token, ADR-006)

extension StatusKind {
    /// The semantic tone for the group — the native equivalent of the web helpers'
    /// status colours: success → `statusSuccess` (web `#22c55e`), warning →
    /// `statusWarning` (`#f59e0b`), danger → `statusDanger` (`#ef4444`), neutral →
    /// `neutral`/muted (`#6b7280`). Resolved through `TSTone` so the surface inherits
    /// light / dark / high-contrast adaptation.
    var tone: TSTone {
        switch self {
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        case .neutral: .neutral
        }
    }
}

// MARK: - Data body (legend + formatting reference)

/// The resolved surface body — the status legend over the formatting reference,
/// wrapped in the shared fade-in (web `FadeIn`).
struct StatusHelpersContent: View {
    let resolved: StatusHelpersResolved

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                if !resolved.legend.isEmpty {
                    StatusLegendSection(rows: resolved.legend)
                }
                if resolved.hasFormatting {
                    StatusFormattingSection(
                        uptimeSeconds: resolved.uptimeSeconds,
                        byteCount: resolved.byteCount
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Status legend (web getStatusColor / getStatusIcon / statusToBadgeVariant)

/// The status legend — a titled list of legend rows, each demonstrating the icon,
/// tint, and badge a status string resolves to.
struct StatusLegendSection: View {
    let rows: [StatusLegendRow]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: StatusHelpersStrings.string("helpers.legendTitle", "Status Legend"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)

            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ForEach(rows) { row in
                    StatusLegendRowView(row: row)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One legend row — the status glyph (tinted by `kind`), the localized status name,
/// and the badge variant (toned by `badgeKind`).
struct StatusLegendRowView: View {
    let row: StatusLegendRow

    private var statusName: String {
        StatusHelpersStrings.string(row.labelKey, row.labelFallback)
    }

    private var variantLabel: String {
        StatusHelpersStrings.string(
            "helpers.variant.\(row.badgeKind.rawValue)",
            StatusHelpers.displayFallback(row.badgeKind.rawValue)
        )
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: row.kind.symbolName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(row.kind.tone.color)
                .frame(width: 22)
                .accessibilityHidden(true)

            Text(verbatim: statusName)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)

            Spacer(minLength: TSSpacing.sm)

            TSBadge(LocalizedStringKey(variantLabel), tone: row.badgeKind.tone)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: StatusHelpersAccessibility.legendRowLabel(
            status: statusName,
            variant: variantLabel
        )))
    }
}

// MARK: - Formatting reference (web formatUptime / formatBytes)

/// The formatting reference — the uptime + storage rows, each rendering the ported
/// formatter against the bound sample. The locale formatting happens here (not in the
/// projection) so the surface honours the device locale at render time.
struct StatusFormattingSection: View {
    let uptimeSeconds: Double?
    let byteCount: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Divider().overlay(Color.TS.border)

            Text(verbatim: StatusHelpersStrings.string("helpers.formattingTitle", "Formatting"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)

            if let uptimeSeconds {
                StatusMetricRow(
                    label: StatusHelpersStrings.string("helpers.uptimeLabel", "Uptime"),
                    value: StatusFormat.formatUptime(uptimeSeconds)
                )
            }
            if let byteCount {
                StatusMetricRow(
                    label: StatusHelpersStrings.string("helpers.bytesLabel", "Storage"),
                    value: StatusFormat.formatBytes(byteCount)
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One label / value formatting row, with a combined VoiceOver summary.
struct StatusMetricRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: StatusHelpersAccessibility.metricLabel(
            label: label,
            value: value
        )))
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: skeleton legend rows so the panel keeps its shape while
/// the parent query resolves.
struct StatusHelpersLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 22, height: 22, cornerRadius: TSRadius.sm)
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 64, height: 12, cornerRadius: TSRadius.pill)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: StatusHelpersStrings.string(
            "helpers.loadingA11y", "Loading status helpers"
        )))
    }
}

/// The empty render: a friendly state, never a blank panel.
struct StatusHelpersEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: StatusHelpersStrings.string("helpers.empty", "No status samples to show."))
            } icon: {
                Image(systemName: "checklist")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct StatusHelpersErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: StatusHelpersStrings.string("helpers.errorTitle", "Couldn't load status helpers"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: StatusHelpersStrings.string("helpers.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: StatusHelpersStrings.string("helpers.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
