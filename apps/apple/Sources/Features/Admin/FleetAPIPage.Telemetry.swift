import SwiftUI

/// Telemetry Capture section (web GlassPanel #3 trailing block): the MongoDB status badge,
/// the raw-recording toggle, and — when capture is on and MongoDB is connected — the
/// retention `Select` (GlassPanel #4) and the captured-signal count note (GlassPanel #5).
/// The whole section dims when MongoDB is configured-off (web `opacity-50`).
struct FleetAPITelemetrySection: View {
    let model: FleetAPIPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            FleetAPIEndpointRow(
                title: "Raw Signal Recording",
                desc: rawDesc,
                isOn: model.polling?["telemetry_capture"] ?? false,
                isBusy: model.isPollingInFlight
            ) {
                Task { await model.toggleEndpoint("telemetry_capture") }
            }
            if showsExtras {
                FleetAPIRetentionRow(model: model)
                if let capture = model.capture, capture.totalDocuments > 0 {
                    FleetAPICaptureStatsNote(capture: capture)
                }
            }
        }
        .opacity(dimmed ? 0.5 : 1)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text("Telemetry Capture")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .textCase(.uppercase)
            if let capture = model.capture {
                TSBadge(
                    capture.mongoEnabled ? "MongoDB Connected" : "MongoDB Not Configured",
                    tone: capture.mongoEnabled ? .success : .neutral
                )
            }
        }
    }

    /// Web ternary on `captureStats.mongodb_enabled` for the raw-recording description.
    private var rawDesc: LocalizedStringKey {
        if let capture = model.capture, !capture.mongoEnabled {
            return "Set MONGODB_ENABLED=true and configure MONGODB_URI to enable"
        }
        return "Capture every fleet telemetry signal to MongoDB for debugging"
    }

    /// Web `pollingConfig.telemetry_capture && captureStats?.mongodb_enabled`.
    private var showsExtras: Bool {
        (model.polling?["telemetry_capture"] ?? false) && (model.capture?.mongoEnabled ?? false)
    }

    /// Web `captureStats && !captureStats.mongodb_enabled` → dim the block.
    private var dimmed: Bool {
        if let capture = model.capture { return !capture.mongoEnabled }
        return false
    }
}

/// Retention-period row (web GlassPanel #4): a label + the days `Select`.
struct FleetAPIRetentionRow: View {
    let model: FleetAPIPageModel

    @MainActor private static let options: [TSSelectOption<Int>] = [
        TSSelectOption(1, "1 day"),
        TSSelectOption(3, "3 days"),
        TSSelectOption(7, "7 days"),
        TSSelectOption(14, "14 days"),
        TSSelectOption(30, "30 days")
    ]

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Retention Period")
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                Text("Auto-delete captured signals after this many days")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            TSSelect(selection: retentionBinding, options: Self.options)
                .frame(maxWidth: 140)
                .disabled(model.isPollingInFlight)
                .accessibilityLabel(Text("Retention Period"))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .fleetAPIGlassRow()
    }

    private var retentionBinding: Binding<Int> {
        Binding(
            get: { model.polling?.retentionDays ?? 7 },
            set: { days in Task { await model.setRetention(days) } }
        )
    }
}

/// Captured-signal count note (web GlassPanel #5): "{n} signals captured from {m} vehicle(s)".
struct FleetAPICaptureStatsNote: View {
    let capture: CaptureStats

    var body: some View {
        composedText
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.statusInfo)
            .fleetAPITinted(.info)
            .accessibilityElement(children: .combine)
    }

    /// Web `{fmtInt(total_documents)} {t('signals captured from')} {distinct_vins.length}
    /// {t('vehicle')}{s}` — composed so each clause keeps its catalog key.
    private var composedText: Text {
        let total = Text(verbatim: FleetAPIFormat.int(capture.totalDocuments))
        let count = Text(verbatim: "\(capture.distinctVINs.count)")
        let plural = Text(verbatim: capture.distinctVINs.count == 1 ? "" : "s")
        return total
            + Text(verbatim: " ") + Text("signals captured from") + Text(verbatim: " ")
            + count + Text(verbatim: " ") + Text("vehicle") + plural
    }
}
