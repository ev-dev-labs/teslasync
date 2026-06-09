//
//  SignalChartPanel.Previews.swift
//  TeslaSync — P4 feature view · 0266 · SignalChartPanel (Apple)
//
//  Xcode previews for each surface state — overlay content, dual-axis content, grid
//  content, live mode, loading, empty (live waiting + historical no-data), error,
//  stale, offline. DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SignalChartUpdate) -> SignalChartModel {
        let source = InMemorySignalChartSource(initial: update)
        let model = SignalChartModel(source: source)
        model.start()
        return model
    }

    private func previewISO(_ secondsAgo: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date().addingTimeInterval(-secondsAgo))
    }

    /// A preview signal descriptor (name + wave baseline/amplitude).
    private struct PreviewSignal {
        let name: String
        let base: Double
        let amp: Double
    }

    /// A sine-wave row series for the named signals, evenly spaced over `count`
    /// samples (the amplitudes let a preview pin a tiny-range signal for dual axis).
    private func previewRows(_ signals: [PreviewSignal], count: Int) -> [SignalChartRow] {
        (0 ..< count).map { step in
            let phase = Double(step) / Double(max(count - 1, 1))
            var values: [String: Double] = [:]
            for (offset, signal) in signals.enumerated() {
                values[signal.name] = signal.base + signal.amp * sin(phase * .pi * 2 + Double(offset) * 0.7)
            }
            return SignalChartRow(timestamp: previewISO(Double((count - step) * 5)), values: values)
        }
    }

    private func previewStats(_ signals: [PreviewSignal]) -> [SignalSeriesStat] {
        signals.map { signal in
            SignalSeriesStat(
                signal: signal.name,
                min: signal.base - signal.amp,
                max: signal.base + signal.amp,
                avg: signal.base,
                count: 60
            )
        }
    }

    private let previewOverlaySignals: [PreviewSignal] = [
        PreviewSignal(name: "vehicle_speed", base: 55, amp: 30),
        PreviewSignal(name: "battery_level", base: 62, amp: 12),
        PreviewSignal(name: "charge_power", base: 18, amp: 9)
    ]

    private let previewDualAxisSignals: [PreviewSignal] = [
        PreviewSignal(name: "battery_level", base: 60, amp: 38),
        PreviewSignal(name: "tpms_pressure_fl", base: 2.8, amp: 0.06)
    ]

    private func previewGridSignals() -> [PreviewSignal] {
        (0 ..< 10).map { index in
            PreviewSignal(
                name: "signal_\(String(format: "%02d", index))",
                base: Double(10 + index * 7),
                amp: Double(3 + index)
            )
        }
    }

    @MainActor
    private func previewContainer(_ model: SignalChartModel) -> some View {
        SignalChartPanel(model: model)
            .padding(TSSpacing.lg)
            .frame(width: 520, alignment: .top)
            .background(Color.TS.bg)
    }

    #Preview("Overlay") {
        previewContainer(previewModel(
            SignalChartUpdate(
                status: .loaded,
                selectedSignals: previewOverlaySignals.map(\.name),
                rows: previewRows(previewOverlaySignals, count: 48),
                stats: previewStats(previewOverlaySignals),
                pointsLoaded: 4821,
                updatedAt: Date()
            )
        ))
    }

    #Preview("Dual axis") {
        previewContainer(previewModel(
            SignalChartUpdate(
                status: .loaded,
                selectedSignals: previewDualAxisSignals.map(\.name),
                rows: previewRows(previewDualAxisSignals, count: 48),
                stats: previewStats(previewDualAxisSignals),
                pointsLoaded: 1280,
                updatedAt: Date()
            )
        ))
    }

    #Preview("Grid (auto)") {
        let signals = previewGridSignals()
        return previewContainer(previewModel(
            SignalChartUpdate(
                status: .loaded,
                selectedSignals: signals.map(\.name),
                rows: previewRows(signals, count: 40),
                stats: previewStats(signals),
                pointsLoaded: 9600,
                updatedAt: Date()
            )
        ))
    }

    #Preview("Live") {
        previewContainer(previewModel(
            SignalChartUpdate(
                status: .loaded,
                isLive: true,
                selectedSignals: previewOverlaySignals.map(\.name),
                rows: previewRows(previewOverlaySignals, count: 48),
                stats: previewStats(previewOverlaySignals),
                liveEventCount: 5123,
                updatedAt: Date()
            )
        ))
    }

    #Preview("Loading") {
        previewContainer(previewModel(SignalChartUpdate(status: .loading)))
    }

    #Preview("Empty (live waiting)") {
        previewContainer(previewModel(SignalChartUpdate(status: .loaded, isLive: true)))
    }

    #Preview("Empty (no data)") {
        previewContainer(previewModel(SignalChartUpdate(status: .loaded)))
    }

    #Preview("Error") {
        previewContainer(previewModel(SignalChartUpdate(status: .failed("Network unavailable"))))
    }

    #Preview("Stale") {
        previewContainer(previewModel(
            SignalChartUpdate(
                status: .loaded,
                connection: .stale,
                selectedSignals: previewOverlaySignals.map(\.name),
                rows: previewRows(previewOverlaySignals, count: 48),
                stats: previewStats(previewOverlaySignals),
                pointsLoaded: 4821,
                updatedAt: Date().addingTimeInterval(-120)
            )
        ))
    }

    #Preview("Offline (cached)") {
        previewContainer(previewModel(
            SignalChartUpdate(
                status: .loaded,
                connection: .offline,
                selectedSignals: previewOverlaySignals.map(\.name),
                rows: previewRows(previewOverlaySignals, count: 48),
                stats: previewStats(previewOverlaySignals),
                pointsLoaded: 4821,
                updatedAt: Date().addingTimeInterval(-900)
            )
        ))
    }
#endif
