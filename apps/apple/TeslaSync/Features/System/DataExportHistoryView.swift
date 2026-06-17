//
//  DataExportHistoryView.swift
//  TeslaSync — P4 feature view · P7 · DataExportPage (Apple) — Export history
//
//  SwiftUI parity of the web `ExportHistoryTable` (parity `GlassPanel10`). The panel
//  always renders and switches its own data state in place (web — the surface is not
//  gated): loading skeletons / a retryable error / the "No Exports Yet" empty state /
//  the job rows. Adaptive (ADR-002/006): each job lays out as a self-describing card
//  that reflows from a single row (regular width) to stacked detail (compact).
//

import SwiftUI

struct DataExportHistoryView: View {
    @Bindable var model: DataExportPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            bodyRegion
        }
        .dataExportPanel()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            Text(String(localized: "dataExport.exportHistory", defaultValue: "Export History"))
        )
    }

    // MARK: Header (title + active badge + refresh)

    private var header: some View {
        HStack(spacing: 12) {
            Text(String(localized: "dataExport.exportHistory", defaultValue: "Export History"))
                .font(.headline)
            if model.activeJobCount > 0 {
                DataExportChip(
                    text: "\(model.activeJobCount) "
                        + String(localized: "dataExport.active", defaultValue: "Active"),
                    systemImage: "circle.fill",
                    tone: .cyan
                )
            }
            Spacer(minLength: 8)
            Button {
                Task { await model.refresh() }
            } label: {
                Label(
                    String(localized: "dataExport.refresh", defaultValue: "Refresh"),
                    systemImage: "arrow.clockwise"
                )
            }
            .buttonStyle(.borderless)
            .font(.subheadline)
        }
    }

    // MARK: Data states (loading / error / empty / success)

    @ViewBuilder
    private var bodyRegion: some View {
        switch model.state {
        case .loading:
            loadingRegion
        case let .error(message):
            errorRegion(message)
        case .empty:
            emptyRegion
        case let .success(jobs):
            jobsRegion(jobs)
        }
    }

    private var loadingRegion: some View {
        VStack(spacing: 10) {
            ForEach(0 ..< 5, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 10)
                    .fill(.quaternary)
                    .frame(height: 44)
                    .redacted(reason: .placeholder) // parity:allow SwiftUI skeleton API
            }
        }
        .accessibilityHidden(true)
    }

    private func errorRegion(_ message: String) -> some View {
        ContentUnavailableView {
            Label(
                String(localized: "dataExport.loadFailed", defaultValue: "Couldn't load exports"),
                systemImage: "exclamationmark.triangle"
            )
        } description: {
            Text(verbatim: message)
        } actions: {
            Button(String(localized: "dataExport.retry", defaultValue: "Retry")) {
                Task { await model.refresh() }
            }
            .buttonStyle(.borderedProminent)
        }
        .accessibilityLabel(Text(verbatim: message))
    }

    private var emptyRegion: some View {
        ContentUnavailableView {
            Label(
                String(localized: "dataExport.noExports", defaultValue: "No Exports Yet"),
                systemImage: "arrow.down.doc"
            )
        } description: {
            Text(String(
                localized: "dataExport.noExportsMessage",
                defaultValue: "Create your first export above to get started."
            ))
        }
    }

    private func jobsRegion(_ jobs: [DataExportJobSummary]) -> some View {
        Group {
            if jobs.isEmpty {
                Text(String(localized: "dataExport.noJobs", defaultValue: "No export jobs"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 8) {
                    ForEach(jobs) { job in
                        DataExportJobRow(job: job, model: model)
                    }
                }
            }
        }
    }
}

// MARK: - Job row (web `DataTable` row — adaptive card)

struct DataExportJobRow: View {
    let job: DataExportJobSummary
    let model: DataExportPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            badges
            details
            actions
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.2), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var typeLabel: String {
        DataExportType(rawValue: job.type)?.localizedLabel ?? job.type
    }

    private var statusText: String {
        job.status == .unknown ? job.rawStatus : job.status.localizedLabel
    }

    /// VoiceOver summary of the three badges (web column headers Type / Format / Status).
    private var badgesAccessibility: String {
        let typeWord = String(localized: "Type", defaultValue: "Type")
        let formatWord = String(localized: "Format", defaultValue: "Format")
        let statusWord = String(localized: "Status", defaultValue: "Status")
        return "\(typeWord): \(typeLabel), \(formatWord): \(job.format.uppercased()), \(statusWord): \(statusText)"
    }

    private var badges: some View {
        HStack(spacing: 6) {
            DataExportChip(text: typeLabel, tone: DataExportType(rawValue: job.type)?.tone ?? .neutral)
            DataExportChip(text: job.format.uppercased(), tone: job.format == "csv" ? .cyan : .purple)
            DataExportChip(
                text: statusText,
                systemImage: job.status.systemImage,
                tone: job.status.tone,
                isSpinning: job.status.isSpinning
            )
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: badgesAccessibility))
    }

    private var details: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 16) { detailItems }
            VStack(alignment: .leading, spacing: 4) { detailItems }
        }
    }

    @ViewBuilder
    private var detailItems: some View {
        detail(String(localized: "Vehicle", defaultValue: "Vehicle"),
               value: model.vehicleLabel(for: job.vehicleID))
        detail(String(localized: "Records", defaultValue: "Records"),
               value: DataExportDisplay.int(job.recordCount))
        detail(String(localized: "Size", defaultValue: "Size"),
               value: DataExportDisplay.bytes(job.fileSize, zeroAsEmpty: true, gbDecimals: 2))
        detail(String(localized: "Duration", defaultValue: "Duration"),
               value: DataExportDisplay.durationMsLong(job.durationMs))
        detail(String(localized: "Time", defaultValue: "Time"),
               value: DataExportDisplay.dateTime(job.createdAt))
    }

    private func detail(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: label)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .textCase(.uppercase)
            Text(verbatim: value)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var actions: some View {
        if let url = model.downloadURL(for: job) {
            Link(destination: url) {
                Label(
                    String(localized: "Download", defaultValue: "Download"),
                    systemImage: "arrow.down.circle"
                )
                .font(.caption.weight(.medium))
            }
            .buttonStyle(.borderless)
        } else if job.status == .failed, let message = job.errorMessage {
            Text(verbatim: message)
                .font(.caption2)
                .foregroundStyle(.red)
                .lineLimit(2)
        }
    }
}
