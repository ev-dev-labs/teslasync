//
//  QueueStatusPanel.Content.swift
//  TeslaSync — P4 feature view · 0037 · QueueStatusPanel (Apple)
//
//  The populated-body subviews composed by `QueueStatusPanel` (web data branch):
//  the responsive worker-card grid and the per-worker card itself — name, host ·
//  version caption, severity label + chevron, the queue-depth bar, the succeeded
//  / failed-24h pair, and the heartbeat + oldest-pending footnotes. Tapping a
//  card opens the per-worker jobs drawer (a separate P4 surface) via the injected
//  navigation closure rather than performing it in the view. All copy resolves
//  through the P1/S10 facade; all styling uses the shared P1/S9 tokens.
//

import SwiftUI

// MARK: - Worker card (web WorkerCard)

/// One worker card: the header (name + host·version + severity label + chevron),
/// the queue-depth bar, the succeeded / failed-24h pair, and the heartbeat +
/// oldest-pending footnotes. The whole card is a button that hands the worker id
/// to the injected `onOpen` closure (web `onClick={() => onOpen(stat.worker)}`).
struct QSWorkerCard: View {
    let worker: QueueWorkerProjection
    let onOpen: (String) -> Void

    private var severityLabel: String {
        QSStrings.string("queueStatus.severity.\(worker.severity.rawValue)", worker.severity.rawValue)
    }

    private var hostCaption: String {
        guard worker.hasHost, let host = worker.host else {
            return QSStrings.string("queueStatus.hostUnknown", "No host reported")
        }
        let version = (worker.version?.isEmpty ?? true)
            ? QSStrings.string("queueStatus.versionUnknown", "unknown")
            : (worker.version ?? "")
        return QSStrings.format(
            "queueStatus.hostVersion",
            "{{host}} · {{version}}",
            ["host": host, "version": version]
        )
    }

    private var depthDetail: String {
        QSStrings.format(
            "queueStatus.queueDepthDetail",
            "{{pending}} pending · {{inProgress}} in progress",
            [
                "pending": QueueStatusAdapter.number(worker.pending),
                "inProgress": QueueStatusAdapter.number(worker.inProgress)
            ]
        )
    }

    private var lastBeatLabel: String {
        guard let lastHeartbeatAt = worker.lastHeartbeatAt else {
            return QSStrings.string("queueStatus.heartbeatNever", "No heartbeat recorded")
        }
        return QSStrings.format(
            "queueStatus.heartbeatRelative",
            "Last beat {{when}}",
            ["when": QueueStatusAdapter.relativeLabel(lastHeartbeatAt)]
        )
    }

    private var heartbeatLabel: String {
        worker.heartbeatDetail.isEmpty ? lastBeatLabel : worker.heartbeatDetail
    }

    private var oldestLabel: String? {
        guard worker.hasBacklog else { return nil }
        return QSStrings.format(
            "queueStatus.oldestPending",
            "Oldest pending: {{duration}}",
            ["duration": QueueStatusAdapter.durationLong(worker.oldestPendingMilliseconds)]
        )
    }

    private var openLabel: String {
        QSStrings.format(
            "queueStatus.openDrawer",
            "Show recent {{worker}} jobs",
            ["worker": worker.displayName]
        )
    }

    private var countsSummary: String {
        let succeeded = QSStrings.string("queueStatus.metric.succeeded24h", "Succeeded 24h")
            + " " + QueueStatusAdapter.number(worker.succeeded24h)
        let failed = QSStrings.string("queueStatus.metric.failed24h", "Failed 24h")
            + " " + QueueStatusAdapter.number(worker.failed24h)
        return succeeded + ", " + failed
    }

    private var accessibilitySummary: String {
        QueueStatusAccessibility.cardSummary(
            name: worker.displayName,
            severity: severityLabel,
            depth: depthDetail,
            counts: countsSummary,
            heartbeat: heartbeatLabel
        )
    }

    var body: some View {
        Button {
            onOpen(worker.worker)
        } label: {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                QSQueueDepthBar(
                    label: QSStrings.string("queueStatus.queueDepth", "Queue depth"),
                    sublabel: depthDetail,
                    fraction: worker.barFraction,
                    tone: worker.severity.tone
                )
                counts
                heartbeatBlock
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
        .accessibilityHint(Text(verbatim: openLabel))
    }

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: worker.displayName)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Text(verbatim: hostCaption)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: TSSpacing.sm)
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: severityLabel)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(worker.severity.tone.color)
                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
        }
    }

    private var counts: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            countCell(
                label: QSStrings.string("queueStatus.metric.succeeded24h", "Succeeded 24h"),
                value: QueueStatusAdapter.number(worker.succeeded24h),
                color: Color.TS.statusSuccess
            )
            countCell(
                label: QSStrings.string("queueStatus.metric.failed24h", "Failed 24h"),
                value: QueueStatusAdapter.number(worker.failed24h),
                color: worker.hasFailures ? Color.TS.statusDanger : Color.TS.textPrimary
            )
        }
    }

    private func countCell(label: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .monospacedDigit()
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var heartbeatBlock: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: heartbeatLabel)
                .font(Font.TS.caption)
                .foregroundStyle(worker.severity.tone.color)
                .fixedSize(horizontal: false, vertical: true)
            if let oldestLabel {
                Text(verbatim: oldestLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusWarning.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Populated grid (web grid-cols-1 md:grid-cols-3)

/// The populated body: the responsive worker-card grid (web `grid-cols-1
/// md:grid-cols-3`). Adaptive columns let the grid collapse to one column on a
/// compact iPhone and fan out to three on a regular-width iPad / Mac window.
struct QSContentView: View {
    let workers: [QueueWorkerProjection]
    let onOpenWorker: (String) -> Void

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.lg, alignment: .top)],
            alignment: .leading,
            spacing: TSSpacing.lg
        ) {
            ForEach(workers) { worker in
                QSWorkerCard(worker: worker, onOpen: onOpenWorker)
            }
        }
        .accessibilityElement(children: .contain)
    }
}
