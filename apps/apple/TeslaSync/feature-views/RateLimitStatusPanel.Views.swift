//
//  RateLimitStatusPanel.Views.swift
//  TeslaSync — P4 feature view · 0038 · RateLimitStatusPanel (Apple)
//
//  The presentational subviews composed by `RateLimitStatusPanel`: the panel header
//  (title + subtitle + "Updated …" + freshness/connectivity chips + Refresh), the
//  loading / error / empty states, and the per-scope budget row (the web
//  `RateLimitRow` — name + severity label, a labeled `TSMetricBar`, and the detail /
//  refill bottom-meta). All consume the P1/S10 facade and the shared P1/S9 tokens —
//  no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Severity → tone (web SEVERITY_COLOR / SEVERITY_TONE_CLASS)

extension RateLimitSeverity {
    /// The shared status tone for the bar fill + severity label (web hex map:
    /// ok #10b981 → success, warn #f59e0b → warning, critical #ef4444 → danger).
    var tone: TSTone {
        switch self {
        case .ok: .success
        case .warn: .warning
        case .critical: .danger
        }
    }

    var labelColor: Color {
        tone.color
    }
}

// MARK: - Runtime chip (mirrors TSBadge tokens for a runtime String)

/// A small tinted capsule mirroring the shared `TSBadge` styling, but taking the
/// runtime string the `LocalizedStringKey`-only `TSBadge` cannot express. Backs the
/// stale / offline header chips (the P4 freshness + connectivity overlays).
struct RLChip: View {
    let text: String
    let systemImage: String
    var tone: TSTone = .neutral

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage).font(.caption2)
            Text(verbatim: text).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Panel header (web title + subtitle + updated + Refresh)

/// The always-visible panel chrome: the title + subtitle, the "Updated …" caption
/// with the stale / offline chips, and the ghost Refresh button (web `Button
/// variant="ghost"` with the spinner while fetching).
struct RLPanelHeader: View {
    let updatedLabel: String?
    let isFetching: Bool
    let isStale: Bool
    let isOffline: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: RLStrings.string("rateLimitStatus.title", "Rate-limit budgets"))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: RLStrings.string("rateLimitStatus.subtitle", Self.subtitleFallback))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                metaRow
            }
            Spacer(minLength: 0)
            refreshButton
        }
    }

    @ViewBuilder
    private var metaRow: some View {
        if updatedLabel != nil || isStale || isOffline {
            HStack(spacing: TSSpacing.sm) {
                if let updatedLabel {
                    Text(verbatim: updatedLabel)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                if isStale {
                    RLChip(
                        text: RLStrings.string("rateLimitStatus.stale", "Stale"),
                        systemImage: "clock.arrow.circlepath",
                        tone: .warning
                    )
                }
                if isOffline {
                    RLChip(
                        text: RLStrings.string("rateLimitStatus.offline", "Offline"),
                        systemImage: "wifi.slash",
                        tone: .neutral
                    )
                }
            }
            .padding(.top, 2)
        }
    }

    private var refreshButton: some View {
        TSButton(variant: .ghost, size: .small, isLoading: isFetching, action: onRefresh) {
            Label {
                Text(verbatim: RLStrings.string("rateLimitStatus.refresh", "Refresh"))
            } icon: {
                Image(systemName: "arrow.clockwise")
            }
        }
        .accessibilityLabel(Text(verbatim: RLStrings.string("rateLimitStatus.refresh", "Refresh")))
    }

    private static let subtitleFallback =
        "Live view of every server-side throttle that affects this TeslaSync deployment. " +
        "Bars climb as the window fills; colour switches from green to amber at 50% and to red at 80%."
}

// MARK: - Loading (web `<Spinner size="sm" /> + text`)

/// The first-load state: an inline spinner with the loading caption (web loading
/// branch). Shown instead of a blank panel before any data resolves.
struct RLLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            Text(verbatim: RLStrings.string("rateLimitStatus.loading", "Loading rate-limit status…"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: RLStrings.string(
            "rateLimitStatus.loadingA11y", "Loading rate-limit status"
        )))
    }
}

// MARK: - Error (web danger box + native retry affordance)

/// The failure box (web error branch: warning triangle + message) with the retry
/// affordance the P4 states contract's `QueryError`-equivalent requires, wired to
/// the model's refresh.
struct RLErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.TS.statusDanger)
                Text(verbatim: RLStrings.string("rateLimitStatus.error", Self.fallback))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.statusDanger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: onRetry) {
                Text(verbatim: RLStrings.string("rateLimitStatus.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: RLStrings.string("rateLimitStatus.retry", "Retry")))
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusDanger.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
    }

    private static let fallback = "Could not load rate-limit status. Check API logs and try again."
}

// MARK: - Empty (web italic secondary text)

/// The zero-scopes state (web `scopes.length === 0` branch): the friendly italic
/// explanation that counters appear once the API has served a request.
struct RLEmptyView: View {
    var body: some View {
        Text(verbatim: RLStrings.string("rateLimitStatus.empty", Self.fallback))
            .font(Font.TS.bodySm)
            .italic()
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, TSSpacing.xs)
    }

    private static let fallback =
        "No rate-limited resources are currently observed. " +
        "Counters appear here once the API has handled at least one request."
}

// MARK: - Rows (web `scopes.map(RateLimitRow)`)

/// The populated state: one `RateLimitRowView` per scope, vertically stacked (web
/// `space-y-5`).
struct RLRowsView: View {
    let rows: [RateLimitRowProjection]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xl) {
            ForEach(rows) { row in
                RateLimitRowView(row: row)
            }
        }
    }
}

// MARK: - One budget row (web `RateLimitRow`)

/// One scope budget: the name + toned severity label, the labeled `TSMetricBar`
/// (window label + usage readout over the proportion bar), and the optional
/// detail / refill bottom-meta — the full native port of the web `RateLimitRow`.
struct RateLimitRowView: View {
    let row: RateLimitRowProjection

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: row.name)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: severityLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(row.severity.labelColor)
            }
            metricBar
            meta
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    private var metricBar: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: windowLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: usageLabel)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(row.severity.labelColor)
            }
            TSMetricBar(fraction: row.fraction, tone: row.severity.tone)
        }
    }

    @ViewBuilder
    private var meta: some View {
        if row.hasMeta {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                if let detail = row.detail {
                    Text(verbatim: detail)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                if let resetLabel {
                    Text(verbatim: resetLabel)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .padding(.top, 2)
        }
    }

    // MARK: Labels (web `t(key, default, opts)` — resolved through the facade)

    private var usageLabel: String {
        RLStrings.format("rateLimitStatus.usage", "{{current}} / {{limit}}", [
            "current": RateLimitNumberFormat.format(row.current),
            "limit": RateLimitNumberFormat.format(row.limit)
        ])
    }

    private var windowLabel: String {
        if row.isInstantWindow {
            return RLStrings.string("rateLimitStatus.windowInstant", "Live snapshot")
        }
        return RLStrings.format("rateLimitStatus.windowSeconds", "Last {{seconds}}s window", [
            "seconds": String(row.windowSeconds)
        ])
    }

    private var resetLabel: String? {
        guard let milliseconds = row.resetMilliseconds else { return nil }
        return RLStrings.format("rateLimitStatus.resetIn", "Refills in {{duration}}", [
            "duration": RateLimitDuration.long(milliseconds)
        ])
    }

    private var severityLabel: String {
        RLStrings.string("rateLimitStatus.severity.\(row.severity.rawValue)", row.severity.rawValue)
    }

    private var accessibilitySummary: String {
        RateLimitAccessibility.rowSummary(
            name: row.name,
            severity: severityLabel,
            usage: usageLabel,
            window: windowLabel,
            reset: resetLabel
        )
    }
}
