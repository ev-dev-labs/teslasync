//
//  BackgroundWorkersCard.Content.swift
//  TeslaSync — P4 feature view · 0240 · BackgroundWorkersCard (Apple)
//
//  The populated-body subviews composed by `BackgroundWorkersCard` (web data
//  branch): the two-axis summary grid, the per-name group cards (header +
//  divided instance rows), the per-instance probe-error box, the `*_HOSTS`
//  scale-callout footer, the API-logs link, and the `BWContentView` that stacks
//  them. All consume the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports. Split out of `…Views.swift` to keep each file
//  within the house file-length budget.
//

import SwiftUI

// MARK: - Two-axis summary (web top-line grid)

/// The types-vs-instances top-line — the key differentiator for horizontally
/// scaled deployments (web summary grid: Worker types · Instances · Replicated).
struct BWSummaryGrid: View {
    let summary: WorkersSummary

    private var typeNoun: String {
        summary.groupCount == 1
            ? BWStrings.string("backgroundWorkers.summary.typeNoun.one", "type")
            : BWStrings.string("backgroundWorkers.summary.typeNoun.other", "types")
    }

    private var replicatedValue: String {
        guard summary.isReplicated else {
            return BWStrings.string("backgroundWorkers.summary.replicatedSingle", "single instance each")
        }
        return BWStrings.format(
            "backgroundWorkers.summary.replicatedValue",
            "{{count}} of {{total}} {{noun}}",
            [
                "count": String(summary.multiInstanceGroups),
                "total": String(summary.groupCount),
                "noun": typeNoun
            ]
        )
    }

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 150), alignment: .leading)],
            alignment: .leading,
            spacing: TSSpacing.md
        ) {
            BWSummaryCell(
                label: BWStrings.string("backgroundWorkers.summary.typesLabel", "Worker types"),
                value: BWStrings.format(
                    "backgroundWorkers.summary.typesValue",
                    "{{healthy}} of {{total}} types",
                    ["healthy": String(summary.healthyGroups), "total": String(summary.groupCount)]
                )
            )
            BWSummaryCell(
                label: BWStrings.string("backgroundWorkers.summary.instancesLabel", "Instances"),
                value: BWStrings.format(
                    "backgroundWorkers.summary.instancesValue",
                    "{{healthy}} of {{total}} instances",
                    ["healthy": String(summary.healthyInstances), "total": String(summary.totalInstances)]
                )
            )
            BWSummaryCell(
                label: BWStrings.string("backgroundWorkers.summary.replicatedLabel", "Replicated"),
                value: replicatedValue
            )
        }
    }
}

/// One label-over-value cell of the summary grid.
struct BWSummaryCell: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label), \(value)"))
    }
}

// MARK: - Group card (web per-name group + instance rows)

/// One worker-name group: the header (status dot + name + healthy rollup chip +
/// instance count) over the divided instance rows.
struct BWGroupCard: View {
    let group: WorkerGroupProjection

    private var severityLabel: String {
        BWStrings.string(
            "backgroundWorkers.group.severity.\(group.severity.rawValue)",
            group.severity.rawValue
        )
    }

    private var healthyChip: String {
        BWStrings.format(
            "backgroundWorkers.group.healthyChip",
            "{{healthy}} / {{total}} healthy",
            ["healthy": String(group.healthyCount), "total": String(group.total)]
        )
    }

    private var instanceCount: String {
        group.isMulti
            ? BWStrings.format(
                "backgroundWorkers.group.instances.other",
                "{{count}} instances",
                ["count": String(group.total)]
            )
            : BWStrings.string("backgroundWorkers.group.instances.one", "1 instance")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ForEach(Array(group.instances.enumerated()), id: \.element.id) { index, instance in
                if index > 0 {
                    Divider().overlay(Color.TS.border.opacity(0.5))
                }
                BWInstanceRow(instance: instance)
            }
        }
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
        )
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            BWStatusDot(tone: group.severity.tone)
            Image(systemName: "square.stack.3d.up.fill")
                .font(.system(size: 13))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: group.name)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
            BWChip(text: healthyChip, tone: group.severity.tone)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: instanceCount)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass.opacity(0.5))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: WorkersAccessibility.groupSummary(
            name: group.name, status: severityLabel, count: healthyChip
        )))
    }
}

// MARK: - Instance row (web per-instance row + probe error)

/// One instance row: status dot + server glyph + short host, the status chip,
/// the latency readout, and the optional red probe-error box.
struct BWInstanceRow: View {
    let instance: WorkerInstanceProjection

    private var statusLabel: String {
        BWStrings.string(
            "backgroundWorkers.instance.status.\(instance.status.rawValue)",
            instance.status.rawValue
        )
    }

    private var latencyText: String {
        guard let latencyMs = instance.latencyMs else {
            return BWStrings.string("backgroundWorkers.latency.none", WorkersAdapter.dash)
        }
        return BWStrings.format("backgroundWorkers.latency.value", "{{ms}} ms", ["ms": String(latencyMs)])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                BWStatusDot(tone: instance.status.tone, size: 8)
                Image(systemName: "server.rack")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: instance.shortHost)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: TSSpacing.sm)
                BWChip(text: statusLabel, tone: instance.status.tone)
                Text(verbatim: latencyText)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(minWidth: 52, alignment: .trailing)
            }
            if let error = instance.error, instance.hasError {
                BWErrorChip(message: error)
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: WorkersAccessibility.instanceSummary(
            host: instance.fullHost,
            status: statusLabel,
            latency: latencyText,
            error: instance.error
        )))
    }
}

/// The per-instance probe-error box (web red `bg-red-500/10` callout).
struct BWErrorChip: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.caption2)
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.statusDanger)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusDanger.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - Scale callout (web `*_HOSTS` footer guidance)

/// Footer guidance shown only when no group is replicated (web
/// `multiInstanceGroups === 0`): how to fan a worker out across hosts via the
/// `*_HOSTS` env contract. The env identifiers render as monospaced code, not
/// translated copy.
struct BWScaleCallout: View {
    private static let hostVars = [
        "NOTIFICATION_WORKER_HOSTS",
        "EXPORT_WORKER_HOSTS",
        "AUTOMATION_WORKER_HOSTS"
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: BWStrings.string("backgroundWorkers.scaleCallout.prefix", Self.prefix))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: TSSpacing.xs) {
                ForEach(Self.hostVars, id: \.self) { variable in
                    TSCode(variable)
                }
            }
            Text(verbatim: BWStrings.string("backgroundWorkers.scaleCallout.suffix", Self.suffix))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass.opacity(0.6),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border.opacity(0.5), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private static let prefix =
        "Running multiple instances of a worker? Set the following to a comma-separated list of hostnames:"
    private static let suffix =
        "Each instance will then appear here with its own status and latency."
}

// MARK: - API logs link (web `<Link to="/api-logs">`)

/// The footer link to the API logs, separated by a top divider (web footer). The
/// route is delivered to the injected navigation closure rather than performed in
/// the view.
struct BWApiLogsLink: View {
    let onOpen: (String) -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Divider().overlay(Color.TS.border)
            HStack {
                Button {
                    onOpen(BackgroundWorkersCard.apiLogsRoute)
                } label: {
                    Label {
                        Text(verbatim: BWStrings.string("backgroundWorkers.apiLogs", "API logs"))
                    } icon: {
                        Image(systemName: "list.bullet.rectangle")
                    }
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.sm)
                    .frame(minHeight: 36)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: BWStrings.string("backgroundWorkers.apiLogs", "API logs")))
                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: - Populated body (web summary + groups + footer + link)

/// The populated card: the two-axis summary, the per-name group cards, the
/// scale-callout footer (iff no group is replicated), and the API-logs link.
struct BWContentView: View {
    let groups: [WorkerGroupProjection]
    let summary: WorkersSummary
    let onOpenAPILogs: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            BWSummaryGrid(summary: summary)
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ForEach(groups) { group in
                    BWGroupCard(group: group)
                }
            }
            if !summary.isReplicated {
                BWScaleCallout()
            }
            BWApiLogsLink(onOpen: onOpenAPILogs)
        }
    }
}
