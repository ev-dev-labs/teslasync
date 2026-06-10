//
//  SignalSparklinePreview.Previews.swift
//  TeslaSync — P4 feature view · 0271 · SignalSparklinePreview (Apple)
//
//  Xcode previews for each surface state — content, content (stale / offline),
//  loading, empty (no samples), non-numeric kind chip, error, and the disabled
//  (`!enabled`) gate. Each preview frames the inline trend inside a leaf-row context
//  (a leading signal name + the trailing preview) to mirror its real placement in a
//  `SignalCategoryTree` leaf. DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SignalSparklineUpdate) -> SignalSparklineModel {
        let source = InMemorySignalSparklineSource(initial: update)
        let model = SignalSparklineModel(source: source)
        model.start()
        return model
    }

    /// A gently varying numeric series for the populated-trend previews.
    private func previewEnvelopes(_ count: Int, base: Double, amplitude: Double) -> [SignalSparklineEnvelope] {
        (0 ..< count).map { step in
            let phase = Double(step) / Double(max(count - 1, 1))
            return SignalSparklineEnvelope(value: .number(base + amplitude * sin(phase * .pi * 2)))
        }
    }

    /// A leaf-row context: the signal name on the left, the inline preview trailing —
    /// the way the web `SignalSparklinePreview` sits in a `SignalCategoryTree` leaf.
    @MainActor
    private func previewRow(_ signal: String, _ model: SignalSparklineModel) -> some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: signal)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.md)
            SignalSparklinePreview(model: model)
        }
        .padding(TSSpacing.md)
        .frame(width: 320, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewRow("vehicle_speed", previewModel(
            SignalSparklineUpdate(
                status: .loaded,
                signal: "vehicle_speed",
                kind: .float,
                envelopes: previewEnvelopes(24, base: 55, amplitude: 28),
                updatedAt: Date()
            )
        ))
    }

    #Preview("Content (stale)") {
        previewRow("battery_level", previewModel(
            SignalSparklineUpdate(
                status: .loaded,
                connection: .stale,
                signal: "battery_level",
                kind: .float,
                envelopes: previewEnvelopes(24, base: 62, amplitude: 10),
                updatedAt: Date().addingTimeInterval(-120)
            )
        ))
    }

    #Preview("Content (offline)") {
        previewRow("charge_power", previewModel(
            SignalSparklineUpdate(
                status: .loaded,
                connection: .offline,
                signal: "charge_power",
                kind: .int,
                envelopes: previewEnvelopes(18, base: 18, amplitude: 9),
                updatedAt: Date().addingTimeInterval(-900)
            )
        ))
    }

    #Preview("Loading") {
        previewRow("tpms_pressure_fl", previewModel(
            SignalSparklineUpdate(status: .loading, signal: "tpms_pressure_fl", kind: .float)
        ))
    }

    #Preview("Empty (no samples)") {
        previewRow("vehicle_speed", previewModel(
            SignalSparklineUpdate(
                status: .loaded,
                signal: "vehicle_speed",
                kind: .float,
                envelopes: [SignalSparklineEnvelope(value: .number(42))]
            )
        ))
    }

    #Preview("Non-numeric (kind chip)") {
        previewRow("shift_state", previewModel(
            SignalSparklineUpdate(status: .loaded, signal: "shift_state", kind: .string)
        ))
    }

    #Preview("Error") {
        previewRow("charge_power", previewModel(
            SignalSparklineUpdate(status: .failed("Network unavailable"), signal: "charge_power", kind: .float)
        ))
    }

    #Preview("Disabled (renders nothing)") {
        previewRow("vehicle_speed", previewModel(
            SignalSparklineUpdate(status: .loaded, enabled: false, signal: "vehicle_speed", kind: .float)
        ))
    }
#endif
