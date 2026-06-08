//
//  AnomalyInlineRow.Previews.swift
//  TeslaSync — P4 feature view · 0238 · AnomalyInlineRow (Apple)
//
//  Xcode previews — one per state the surface produces: loading (row-shaped shimmer),
//  content across the three severities (critical → unhealthy, warning → degraded,
//  info → unknown), the stale + offline freshness variants, the friendly empty state
//  (web `return null`), and the error state with retry. A fixed clock makes the relative
//  time deterministic. DEBUG-only; excluded from release builds.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentAnomalyInlineRowTelemetry: AnomalyInlineRowTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample anomaly payloads anchored to a fixed "now" so the relative time is stable.
    private enum AnomalyInlineRowPreviewData {
        static let now = Date(timeIntervalSince1970: 1_717_000_000)

        static func entry(signal: String, severity: AnomalySeverity, minutesAgo: Double) -> AnomalyEntryItem {
            AnomalyEntryItem(
                signal: signal,
                type: .zScore,
                severity: severity,
                value: 412.5,
                baseline: 360,
                zScore: 3.8,
                detectedAt: now.addingTimeInterval(-minutesAgo * 60),
                message: "Reading deviated from the rolling baseline"
            )
        }

        static func data(count: Int, severity: AnomalySeverity, signal: String, minutesAgo: Double) -> AnomalyData {
            AnomalyData(
                anomalies: [entry(signal: signal, severity: severity, minutesAgo: minutesAgo)],
                signalsMonitored: 42,
                anomaliesLast7d: count + 4,
                anomaliesLast24h: count
            )
        }
    }

    @MainActor
    private func anomalyInlineRowPreview(_ update: AnomalyInlineRowUpdate) -> AnomalyInlineRow {
        let model = AnomalyInlineRowModel(
            source: InMemoryAnomalyInlineRowSource(initial: update),
            telemetry: SilentAnomalyInlineRowTelemetry(),
            now: { AnomalyInlineRowPreviewData.now }
        )
        return AnomalyInlineRow(model: model)
    }

    private struct AnomalyInlineRowPreviewGallery: View {
        var body: some View {
            ScrollView {
                VStack(spacing: TSSpacing.sm) {
                    anomalyInlineRowPreview(AnomalyInlineRowUpdate(status: .loading))
                    anomalyInlineRowPreview(
                        AnomalyInlineRowUpdate(
                            status: .loaded,
                            data: AnomalyInlineRowPreviewData.data(
                                count: 3, severity: .critical, signal: "battery_temp", minutesAgo: 5
                            )
                        )
                    )
                    anomalyInlineRowPreview(
                        AnomalyInlineRowUpdate(
                            status: .loaded,
                            data: AnomalyInlineRowPreviewData.data(
                                count: 7, severity: .warning, signal: "tire_pressure_fl", minutesAgo: 95
                            ),
                            connection: .stale
                        )
                    )
                    anomalyInlineRowPreview(
                        AnomalyInlineRowUpdate(
                            status: .loaded,
                            data: AnomalyInlineRowPreviewData.data(
                                count: 2, severity: .info, signal: "cabin_temp", minutesAgo: 1500
                            ),
                            connection: .offline
                        )
                    )
                    anomalyInlineRowPreview(
                        AnomalyInlineRowUpdate(status: .loaded, data: AnomalyData(anomalies: [], anomaliesLast24h: 0))
                    )
                    anomalyInlineRowPreview(AnomalyInlineRowUpdate(status: .failed("Request timed out")))
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: 440)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("States · Dark") {
        AnomalyInlineRowPreviewGallery()
            .preferredColorScheme(.dark)
    }

    #Preview("States · Light") {
        AnomalyInlineRowPreviewGallery()
            .preferredColorScheme(.light)
    }

    #Preview("Dynamic Type · XXL") {
        AnomalyInlineRowPreviewGallery()
            .preferredColorScheme(.dark)
            .environment(\.dynamicTypeSize, .accessibility2)
    }
#endif
