import SwiftUI

// The summary stat cards, the system-health grid, the anomaly timeline, and the loading skeleton
// for the Anomaly Detection surface (web Summary `StatCard`s + the System-Health, Anomaly-Timeline
// `GlassPanel`s). The signal-frequency chart lives in `AnomalyDashboardPage.Charts.swift`. Each
// panel renders its own empty state (never a blank region); raw numbers format via
// `AnomalyDashboardFormat` at this display boundary.

// MARK: - Summary stats (web 4 StatCards: Signals-Monitored / Anomalies-7d / 24h / Health-Categories)

/// The four summary cards (web Summary-Stats `StaggerContainer`). Reflows two-up on compact iPhone
/// and four-up on regular width (web `grid-cols-2 lg:grid-cols-4`).
struct AnomalyDashboardSummarySection: View {
    let data: AnomalyData
    let isCompact: Bool

    private var columns: [GridItem] {
        let count = isCompact ? 2 : 4
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: count)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            TSStatCard(
                title: "anomaly.monitored",
                value: AnomalyDashboardFormat.integer(data.signalsMonitored),
                systemImage: "waveform.path.ecg"
            )
            TSStatCard(
                title: "anomaly.last7d",
                value: AnomalyDashboardFormat.integer(data.anomaliesLast7d),
                systemImage: "exclamationmark.triangle.fill"
            )
            TSStatCard(
                title: "anomaly.last24h",
                value: AnomalyDashboardFormat.integer(data.anomaliesLast24h),
                systemImage: "shield.fill"
            )
            TSStatCard(
                title: "anomaly.categories",
                value: AnomalyDashboardFormat.integer(data.healthCategoryCount),
                systemImage: "thermometer.medium"
            )
        }
    }
}

// MARK: - System health (web GlassPanel5 — health category grid, or empty)

/// The System-Health grid (web "System Health" `GlassPanel`): one tinted tile per category with a
/// status-colored icon and a status badge — or a no-data empty state. Reflows for width.
struct AnomalyDashboardHealthSection: View {
    let categories: [AnomalyHealthCategory]

    private let columns = [GridItem(.adaptive(minimum: 130), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle("anomaly.healthSummary")
                if categories.isEmpty {
                    TSEmptyState(title: "anomaly.noHealth", systemImage: "waveform.path.ecg")
                        .frame(maxWidth: .infinity)
                } else {
                    LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                        ForEach(categories) { category in
                            AnomalyHealthCard(category: category)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One system-health tile (web health card): a status-tinted icon, the category name, and a status
/// badge, on a tinted bordered surface (web `statusBg` + `statusColor`).
struct AnomalyHealthCard: View {
    let category: AnomalyHealthCategory

    private var tone: TSTone {
        AnomalyDashboardFormat.tone(for: category.severity)
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: AnomalyDashboardFormat.healthIcon(for: category.category))
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(tone.color)
            Text(verbatim: category.category.capitalized)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            TSBadge(LocalizedStringKey(category.status), tone: tone)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.md)
        .background(
            tone.color.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(tone.color.opacity(0.2), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Anomaly timeline (web GlassPanel6 — anomaly rows, or empty)

/// The Anomaly-Timeline panel (web "Anomaly Timeline" `GlassPanel`): a list of detected anomalies,
/// each with its severity badge, signal, type, z-score, message, value/baseline, and timestamp —
/// or a no-anomalies empty state (web `noAnomalies`).
struct AnomalyDashboardTimelineSection: View {
    let anomalies: [AnomalyEntry]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.TS.statusWarning)
                        .accessibilityHidden(true)
                    TSPanelTitle("anomaly.timeline")
                }
                if anomalies.isEmpty {
                    TSEmptyState(title: "anomaly.noAnomalies", systemImage: "checkmark.shield")
                        .frame(maxWidth: .infinity)
                } else {
                    VStack(spacing: TSSpacing.md) {
                        ForEach(anomalies) { anomaly in
                            AnomalyTimelineRow(anomaly: anomaly)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One anomaly row (web timeline item): severity badge + signal/type/σ + message + value/baseline +
/// relative timestamp, on a severity-tinted surface.
struct AnomalyTimelineRow: View {
    let anomaly: AnomalyEntry

    private var tone: TSTone {
        AnomalyDashboardFormat.tone(for: anomaly.severity)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSBadge(LocalizedStringKey(anomaly.severity.raw), tone: tone)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                headline
                Text(verbatim: anomaly.message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                meta
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
        .padding(TSSpacing.md)
        .background(rowBackground)
        .accessibilityElement(children: .combine)
        .accessibilityValue(Text(verbatim: AnomalyDashboardFormat.absoluteTimestamp(anomaly.detectedAt)))
    }

    private var headline: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: anomaly.signal)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            typeChip
            if anomaly.showsZScore {
                Text(verbatim: AnomalyDashboardFormat.zScore(anomaly.zScore))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private var typeChip: some View {
        Text(verbatim: AnomalyDashboardFormat.typeLabel(anomaly.type))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.surface, in: Capsule())
    }

    private var meta: some View {
        HStack(spacing: TSSpacing.md) {
            labeled("anomaly.value", AnomalyDashboardFormat.signalValue(anomaly.value))
            labeled("anomaly.baseline", AnomalyDashboardFormat.signalValue(anomaly.baseline))
            Text(verbatim: AnomalyDashboardFormat.relativeTimestamp(anomaly.detectedAt))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func labeled(_ key: LocalizedStringKey, _ value: String) -> some View {
        HStack(spacing: 2) {
            Text(key)
            Text(verbatim: value)
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
    }

    private var rowBackground: some View {
        let tint = AnomalyDashboardFormat.rowTone(for: anomaly.severity)
        return RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(tint?.color.opacity(0.06) ?? Color.TS.surface.opacity(0.4))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder((tint?.color ?? Color.TS.border).opacity(0.18), lineWidth: 1)
            )
    }
}

// MARK: - Loading skeleton (web Skeleton loading state)

/// Mirrors the page layout while the source loads (the manifest's `loading → redacted(reason:)`):
/// four summary cards → the health panel → the timeline panel → the frequency chart, all redacted.
struct AnomalyDashboardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)],
                spacing: TSSpacing.md
            ) {
                ForEach(0 ..< 4, id: \.self) { _ in skeletonBlock(height: 84) }
            }
            skeletonBlock(height: 180)
            skeletonBlock(height: 240)
            skeletonBlock(height: 260)
        }
        .anomalyRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("anomaly.title"))
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies SwiftUI's skeleton redaction while `loading`, matching the web Skeleton loading
    /// state (the manifest's `loading → redacted(reason:)` requirement).
    func anomalyRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}
