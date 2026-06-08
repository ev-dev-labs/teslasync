//
//  DataPipelineSection.Views.swift
//  TeslaSync — P4 feature view · 0242 · DataPipelineSection (Apple)
//
//  The presentational subviews composed by `DataPipelineSection`: the header badge
//  cluster, the freshness chip + connectivity banner, the Compression Statistics block
//  (metric grid + savings radial gauge, or its empty state), the Export Job
//  Queue block (status stat-cards + jobs table, or the web `EmptyState`), and the
//  loading / error chrome. All consume the P1/S10 facade and the shared P1/S9 tokens —
//  no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Localization bridge (SwiftUI layer over the P1/S10 facade)

extension DataPipelineStrings {
    /// The `LocalizedStringKey` convenience for shared components that take one
    /// (`TSBadge`, `TSColumn`, `TSEmptyState`); the resolved string is not a
    /// main-catalog key, so SwiftUI renders it verbatim.
    static func key(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(string(key, fallback))
    }
}

// MARK: - Tone bridge (pure `DataPipelineTone` → shared `TSTone` tokens)

extension DataPipelineTone {
    /// Maps the view-free status tone to the shared design-token tone (web semantic
    /// colour, not literal hex).
    var tsTone: TSTone {
        switch self {
        case .neutral: .neutral
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        case .info: .info
        }
    }
}

// MARK: - Responsive grid (web `cols={{ default: 2, md: 4 }}`)

/// A two-or-four column metric/stat grid — two columns on compact iPhone width, four
/// on regular width / macOS, mirroring the web `Grid` breakpoints.
private struct DataPipelineGrid<Content: View>: View {
    @ViewBuilder let content: () -> Content

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var columnCount: Int {
            horizontalSizeClass == .compact ? 2 : 4
        }
    #else
        private var columnCount: Int {
            4
        }
    #endif

    var body: some View {
        LazyVGrid(
            columns: Array(
                repeating: GridItem(.flexible(), spacing: TSSpacing.md, alignment: .top),
                count: columnCount
            ),
            alignment: .leading,
            spacing: TSSpacing.md,
            content: content
        )
    }
}

// MARK: - Header badges (web savings / active-jobs cluster)

/// The accordion header badges — the compression savings badge (web info badge) and
/// the active-jobs badge (web warning badge), each shown only when applicable.
struct DataPipelineHeaderBadges: View {
    let resolved: DataPipelineResolved

    private var savingsText: String {
        let percent = DataPipelineFormat.percent(resolved.compression?.savingsPercent ?? 0)
        return "\(percent) \(DataPipelineStrings.string("saved", "saved"))"
    }

    private var activeText: String {
        "\(resolved.counts.active) \(DataPipelineStrings.string("active", "active"))"
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if resolved.showSavingsBadge {
                TSBadge(LocalizedStringKey(savingsText), tone: .info)
                    .accessibilityLabel(Text(verbatim: savingsText))
            }
            if resolved.showActiveBadge {
                TSBadge(LocalizedStringKey(activeText), tone: .warning)
                    .accessibilityLabel(Text(verbatim: activeText))
            }
        }
    }
}

// MARK: - Freshness chip + connectivity banner (P4 leaf chrome)

/// The feed freshness chip (live / stale / offline) — a coloured dot + label.
struct DataPipelineFreshnessChip: View {
    let connection: DataPipelineConnection

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: DataPipelineStrings.string("pipeline.live", "Live")
        case .stale: DataPipelineStrings.string("pipeline.stale", "Stale")
        case .offline: DataPipelineStrings.string("pipeline.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// The stale / offline banner — cached data stays visible behind it.
struct DataPipelineConnectivityBanner: View {
    let connection: DataPipelineConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var label: String {
        isOffline
            ? DataPipelineStrings.string("pipeline.offlineBanner", "Offline — showing last known data")
            : DataPipelineStrings.string("pipeline.staleBanner", "Reconnecting — data may be stale")
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: label)
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

// MARK: - Ready content (web non-loading render: compression + export queue)

/// The resolved panel body — the Compression Statistics block over the Export Job
/// Queue block (web `space-y-6`).
struct DataPipelineReadyContent: View {
    let resolved: DataPipelineResolved

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xl) {
            DataPipelineCompressionSection(compression: resolved.compression, fraction: resolved.savingsFraction)
            DataPipelineExportSection(jobs: resolved.jobs, counts: resolved.counts)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Compression block (web `{compression && …}` — always shown, never hidden)

/// The Compression Statistics block — the four metric cards + the savings radial
/// gauge when data is present, otherwise a friendly empty state (the section is
/// always rendered so no surface is hidden).
struct DataPipelineCompressionSection: View {
    let compression: CompressionSnapshot?
    let fraction: Double

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSPanelTitle(DataPipelineStrings.key("Compression Statistics", "Compression Statistics"))
            if let compression {
                DataPipelineGrid {
                    TSMetricCard(
                        title: DataPipelineStrings.key("Compression Ratio", "Compression Ratio"),
                        value: DataPipelineFormat.percent(compression.savingsPercent)
                    )
                    TSMetricCard(
                        title: DataPipelineStrings.key("Estimated Savings", "Estimated Savings"),
                        value: DataPipelineFormat.bytes(compression.estimatedSavedBytes)
                    )
                    TSMetricCard(
                        title: DataPipelineStrings.key("Total Positions", "Total Positions"),
                        value: DataPipelineFormat.int(compression.totalPositions)
                    )
                    TSMetricCard(
                        title: DataPipelineStrings.key("Compressed", "Compressed"),
                        value: DataPipelineFormat.int(compression.compressedPositions)
                    )
                }
                HStack {
                    Spacer(minLength: 0)
                    TSRadialGauge(
                        value: fraction,
                        label: DataPipelineStrings.key("Savings", "Savings")
                    )
                    Spacer(minLength: 0)
                }
            } else {
                TSEmptyState(
                    title: DataPipelineStrings.key("pipeline.noCompression", "No compression statistics yet"),
                    systemImage: "archivebox"
                )
                .frame(maxWidth: .infinity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Export queue block (web stat-cards + `DataTable` / `EmptyState`)

/// The Export Job Queue block — the four status stat-cards + the jobs table when the
/// queue has rows, otherwise the web `EmptyState` ("No export jobs in queue").
struct DataPipelineExportSection: View {
    let jobs: [ExportJobItem]
    let counts: DataPipelineCounts

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSPanelTitle(DataPipelineStrings.key("Export Job Queue", "Export Job Queue"))
            if jobs.isEmpty {
                TSEmptyState(
                    title: DataPipelineStrings.key("pipeline.noJobs", "No export jobs in queue"),
                    systemImage: "tray"
                )
                .frame(maxWidth: .infinity)
            } else {
                DataPipelineStatGrid(counts: counts)
                DataPipelineJobsTable(jobs: jobs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The four queue status tallies (web `StatCard`s: Pending / Processing / Completed /
/// Failed).
struct DataPipelineStatGrid: View {
    let counts: DataPipelineCounts

    var body: some View {
        DataPipelineGrid {
            TSStatCard(
                title: DataPipelineStrings.key("Pending", "Pending"),
                value: "\(counts.pending)",
                systemImage: "clock"
            )
            TSStatCard(
                title: DataPipelineStrings.key("Processing", "Processing"),
                value: "\(counts.processing)",
                systemImage: "waveform.path.ecg"
            )
            TSStatCard(
                title: DataPipelineStrings.key("Completed", "Completed"),
                value: "\(counts.completed)",
                systemImage: "checkmark.circle"
            )
            TSStatCard(
                title: DataPipelineStrings.key("Failed", "Failed"),
                value: "\(counts.failed)",
                systemImage: "xmark.circle"
            )
        }
    }
}

// MARK: - Loading / error chrome (web `isLoading` skeletons + `QueryError` peer)

/// The initial-fetch chrome — the web two skeleton blocks (`h-32` over `h-48`).
struct DataPipelineLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(height: 128, cornerRadius: TSRadius.md)
            TSSkeleton(height: 192, cornerRadius: TSRadius.md)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: DataPipelineStrings.string(
            "pipeline.loadingA11y",
            "Loading data pipeline"
        )))
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct DataPipelineErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: DataPipelineStrings.string("pipeline.errorTitle", "Couldn't load the data pipeline"))
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
                Text(verbatim: DataPipelineStrings.string("pipeline.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: DataPipelineStrings.string("pipeline.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
