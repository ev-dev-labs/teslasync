//
//  QueueStatusPanel.Views.swift
//  TeslaSync — P4 feature view · 0037 · QueueStatusPanel (Apple)
//
//  The chrome + state subviews composed by `QueueStatusPanel`: the panel header
//  (title + subtitle + "Updated …" stamp + freshness/connectivity chips +
//  Refresh), the loading / error / empty states, and the shared leaf primitives
//  (severity tone, runtime chip, queue-depth bar). All consume the P1/S10 facade
//  and the shared P1/S9 tokens — no networking, no Tailwind ports. The populated
//  grid lives in `…Content.swift` to keep each file within the house length
//  budget.
//

import SwiftUI

// MARK: - Severity → tone (web SEVERITY_COLOR / SEVERITY_TONE_CLASS)

extension QueueHeartbeatSeverity {
    /// The shared status tone for the severity label + queue-depth bar (web
    /// colour map: ok → emerald, warn → amber, critical → red, down → slate).
    var tone: TSTone {
        switch self {
        case .ok: .success
        case .warn: .warning
        case .critical: .danger
        case .down: .neutral
        }
    }
}

// MARK: - Runtime chip (mirrors TSBadge tokens for a runtime String)

/// A small tinted capsule mirroring the shared `TSBadge` styling, but taking the
/// runtime string the `LocalizedStringKey`-only `TSBadge` cannot express. Backs
/// the stale / offline header chips.
struct QSChip: View {
    let text: String
    var systemImage: String?
    var tone: TSTone = .neutral

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage).font(.caption2)
            }
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

// MARK: - Queue-depth bar (web MetricBar: label + sublabel + tinted fill)

/// The queue-depth row — the native composition of the web `MetricBar`: the
/// "Queue depth" label, the "{pending} pending · {inProgress} in progress"
/// sublabel in the severity tone, and the proportional fill (full whenever there
/// is any depth, empty at zero) via the shared `TSMetricBar`.
struct QSQueueDepthBar: View {
    let label: String
    let sublabel: String
    let fraction: Double
    let tone: TSTone

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: sublabel)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(tone.color)
                    .multilineTextAlignment(.trailing)
            }
            TSMetricBar(fraction: fraction, tone: tone)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(label), \(sublabel)"))
    }
}

// MARK: - Panel header (native chrome: title + Refresh + freshness chips)

/// The always-visible panel chrome: the title + subtitle, the "Updated …" stamp,
/// the stale / offline chips, and the ghost Refresh button (spinner while a
/// background refetch is in flight, disabled while fetching — the web
/// `loading={isFetching && !isLoading} disabled={isFetching}`).
struct QSPanelHeader: View {
    let isFetching: Bool
    let isFirstLoad: Bool
    let isStale: Bool
    let isOffline: Bool
    let generatedAt: Date?
    let onRefresh: () -> Void

    private var updatedLabel: String? {
        guard let generatedAt else { return nil }
        return QSStrings.format(
            "queueStatus.lastUpdated",
            "Updated {{when}}",
            ["when": QueueStatusAdapter.relativeLabel(generatedAt)]
        )
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: QSStrings.string("queueStatus.title", "Background workers"))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: QSStrings.string("queueStatus.subtitle", Self.subtitleFallback))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let updatedLabel {
                    Text(verbatim: updatedLabel)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                chipRow
            }
            Spacer(minLength: 0)
            refreshButton
        }
    }

    @ViewBuilder
    private var chipRow: some View {
        if isStale || isOffline {
            HStack(spacing: TSSpacing.sm) {
                if isStale {
                    QSChip(
                        text: QSStrings.string("queueStatus.stale", "Stale"),
                        systemImage: "clock.arrow.circlepath",
                        tone: .warning
                    )
                }
                if isOffline {
                    QSChip(
                        text: QSStrings.string("queueStatus.offline", "Offline"),
                        systemImage: "wifi.slash",
                        tone: .neutral
                    )
                }
            }
            .padding(.top, 2)
        }
    }

    private var refreshButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            isLoading: isFetching && !isFirstLoad,
            action: onRefresh
        ) {
            Label {
                Text(verbatim: QSStrings.string("queueStatus.refresh", "Refresh"))
            } icon: {
                Image(systemName: "arrow.clockwise")
            }
        }
        .disabled(isFetching)
        .accessibilityLabel(Text(verbatim: QSStrings.string("queueStatus.refresh", "Refresh")))
    }

    private static let subtitleFallback =
        "Live view of the notification, export, and automation worker queues. " +
        "Heartbeat colour switches from green to amber after 60 seconds and to red after " +
        "5 minutes of silence; \"down\" means the worker has never reported in."
}

// MARK: - Loading / error / empty

/// The first-load state: an inline spinner with the loading caption (web
/// `isLoading` branch).
struct QSLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            Text(verbatim: QSStrings.string("queueStatus.loading", "Loading worker status…"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: QSStrings.string(
            "queueStatus.loadingA11y", "Loading worker status"
        )))
    }
}

/// The failure box (warning triangle + message) with the retry affordance the P4
/// states contract's `QueryError`-equivalent requires, wired to the refresh (web
/// `error` branch, which has no retry — the native HIG surface adds one).
struct QSErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.TS.statusDanger)
                Text(verbatim: QSStrings.string("queueStatus.error", Self.fallback))
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
                Text(verbatim: QSStrings.string("queueStatus.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: QSStrings.string("queueStatus.retry", "Retry")))
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

    private static let fallback = "Could not load worker status. Check API logs and try again."
}

/// The zero-workers state (web `workers.length === 0` branch): the friendly
/// explanation that the worker processes report here once they start.
struct QSEmptyView: View {
    var body: some View {
        Text(verbatim: QSStrings.string("queueStatus.empty", Self.fallback))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .italic()
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
    }

    private static let fallback =
        "No workers are currently registered. The notification, export, and automation " +
        "processes report here once they start."
}
