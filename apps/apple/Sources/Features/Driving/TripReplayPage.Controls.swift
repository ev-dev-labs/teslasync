import SwiftUI

// The trip-replay transport + live stat bar (web `PlaybackControls` + the "Current Position
// Stats" `GlassPanel`). The transport drives the shared replay clock; the stat bar reads the
// sample under the playhead and converts each unit-bearing value at the render boundary via
// `Units` (ADR-005). Both reflow for compact vs. regular width and every value falls back to the
// em-dash sentinel when the current sample didn't record it (web `'—'`).

// MARK: - Transport (web `PlaybackControls`)

struct TripReplayControlsSection: View {
    @Bindable var model: TripReplayPageModel

    private var progressBinding: Binding<Double> {
        Binding(get: { model.progressFraction }, set: { model.seekTo(progress: $0) })
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TripReplayScrubberTrack(
                    sparkline: model.speedSparkline,
                    markers: model.markers,
                    progress: model.progressFraction
                )
                Slider(value: progressBinding, in: 0 ... 1)
                    .tint(Color.TS.accent)
                    .accessibilityLabel(Text("replay.controls.progress"))
                    .accessibilityValue(Text(verbatim: TripReplayPageFormat.percent(model.progressFraction * 100)))
                transportRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var transportRow: some View {
        HStack(spacing: TSSpacing.md) {
            transportButton("replay.controls.stop", systemImage: "stop.fill") { model.stop() }

            transportButton(
                "replay.shortcuts.skip5",
                systemImage: "gobackward.5"
            ) { model.seekBy(seconds: -5) }
            .keyboardShortcut(.leftArrow, modifiers: [])

            Button { model.togglePlay() } label: {
                Image(systemName: model.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 44, height: 44)
                    .foregroundStyle(.white)
                    .background(Color.TS.accent, in: Circle())
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.space, modifiers: [])
            .accessibilityLabel(Text(model.isPlaying ? "replay.controls.pause" : "replay.controls.play"))

            transportButton(
                "replay.shortcuts.skip5",
                systemImage: "goforward.5"
            ) { model.seekBy(seconds: 5) }
            .keyboardShortcut(.rightArrow, modifiers: [])

            Spacer(minLength: TSSpacing.sm)

            Text(verbatim: timeReadout)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityLabel(Text("replay.controls.progress"))

            speedControl
        }
    }

    private var timeReadout: String {
        "\(TripReplayPageFormat.duration(milliseconds: model.elapsedMs)) / "
            + TripReplayPageFormat.duration(milliseconds: model.totalTimeMs)
    }

    /// The playback-speed control — the canonical shared `PlaybackSpeedMenu` surface (web
    /// `<PlaybackSpeedMenu>`), bound to the page's `speed` with the page handling each change.
    private var speedControl: some View {
        PlaybackSpeedMenu(speed: model.speed) { next in
            model.setSpeed(next)
        }
        .tint(Color.TS.accent)
    }

    private func transportButton(
        _ label: LocalizedStringKey,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 36, height: 36)
                .foregroundStyle(Color.TS.textPrimary)
                .background(Color.TS.surface, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }
}

/// The decorative scrubber track (web sparkline background + marker ticks + playhead). The native
/// `Slider` above carries the accessible seek; this bar is `accessibilityHidden`.
struct TripReplayScrubberTrack: View {
    let sparkline: [Double]
    let markers: [TripReplayMarker]
    let progress: Double

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let height = geometry.size.height
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .fill(Color.TS.surface)
                sparklinePath(width: width, height: height)
                    .stroke(Color.TS.accent.opacity(0.7), lineWidth: 1.5)
                ForEach(markers) { marker in
                    Capsule()
                        .fill(markerColor(marker.kind))
                        .frame(width: 2, height: height)
                        .offset(x: CGFloat(marker.at) * width)
                }
                Capsule()
                    .fill(Color.TS.accent)
                    .frame(width: 2, height: height)
                    .offset(x: CGFloat(min(max(progress, 0), 1)) * width)
            }
        }
        .frame(height: 28)
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityHidden(true)
    }

    private func sparklinePath(width: CGFloat, height: CGFloat) -> Path {
        Path { path in
            guard sparkline.count > 1, width > 0 else { return }
            let maxValue = sparkline.max() ?? 1
            let denominator = maxValue > 0 ? maxValue : 1
            let step = width / CGFloat(sparkline.count - 1)
            for (index, value) in sparkline.enumerated() {
                let x = CGFloat(index) * step
                let y = height - CGFloat(value / denominator) * height
                if index == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
            }
        }
    }

    private func markerColor(_ kind: TripReplayMarkerKind) -> Color {
        switch kind {
        case .start: Color.TS.statusSuccess
        case .stop: Color.TS.statusDanger
        case .fastSegment: Color.TS.statusWarning
        case .regenPeak: TSChartPalette.color(at: 5)
        case .lowSoc: Color.TS.statusDanger
        }
    }
}

// MARK: - Current position stats (web "Current Position Stats" panel)

struct TripReplayStatsSection: View {
    let model: TripReplayPageModel

    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 130), spacing: TSSpacing.md)]

    private var current: TripDrivePosition? {
        model.currentPosition
    }

    private var activeKind: TripReplayMarkerKind? {
        model.activeMarker?.kind
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("replay.currentStats")
                LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                    TripReplayStatTile(
                        systemImage: "gauge.medium",
                        label: "replay.stat.speed",
                        value: speedValue,
                        highlighted: activeKind == .fastSegment
                    )
                    TripReplayStatTile(
                        systemImage: "bolt.fill",
                        label: "replay.stat.power",
                        value: powerValue,
                        help: "help.replay.power",
                        highlighted: activeKind == .regenPeak
                    )
                    TripReplayStatTile(
                        systemImage: "battery.50percent",
                        label: "replay.stat.battery",
                        value: batteryValue,
                        help: "help.replay.battery",
                        highlighted: activeKind == .lowSoc
                    )
                    TripReplayStatTile(
                        systemImage: "mountain.2.fill",
                        label: "replay.stat.elevation",
                        value: elevationValue
                    )
                    TripReplayStatTile(
                        systemImage: "location.north.line.fill",
                        label: "replay.stat.range",
                        value: rangeValue,
                        help: "help.replay.range"
                    )
                    TripReplayStatTile(
                        systemImage: "thermometer.medium",
                        label: "replay.stat.temp",
                        value: temperatureValue
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var speedValue: String {
        guard let speed = current?.speedMps else { return TripReplayPageFormat.emptyValue }
        return Units.formatSpeed(speed, units)
    }

    private var powerValue: String {
        guard let power = current?.powerW else { return TripReplayPageFormat.emptyValue }
        return "\(TripReplayPageFormat.number(power / 1000, decimals: 1)) kW"
    }

    private var batteryValue: String {
        guard let current else { return TripReplayPageFormat.emptyValue }
        return "\(TripReplayPageFormat.int(current.batteryPct))%"
    }

    private var elevationValue: String {
        guard let elevation = current?.elevationM else { return TripReplayPageFormat.emptyValue }
        return "\(TripReplayPageFormat.int(elevation)) m"
    }

    private var rangeValue: String {
        guard let range = current?.ratedRangeM else { return TripReplayPageFormat.emptyValue }
        return Units.formatDistance(range, units)
    }

    private var temperatureValue: String {
        guard let temp = current?.outsideTempC else { return TripReplayPageFormat.emptyValue }
        return Units.formatTemperature(temp, units)
    }
}

/// One current-position stat cell (web `MetricCard` with icon + optional help tooltip + active
/// highlight ring). The help text surfaces in a HIG popover (the web tooltip) on tap.
struct TripReplayStatTile: View {
    let systemImage: String
    let label: LocalizedStringKey
    let value: String
    var help: LocalizedStringKey?
    var highlighted = false

    @State private var showHelp = false

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: systemImage)
                        .font(.caption)
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    TSMetricLabel(label)
                    Spacer(minLength: 0)
                    if let help {
                        Button { showHelp.toggle() } label: {
                            Image(systemName: "questionmark.circle")
                                .font(.caption)
                                .foregroundStyle(Color.TS.textMuted)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("replay.help"))
                        .popover(isPresented: $showHelp) {
                            Text(help)
                                .font(Font.TS.bodySm)
                                .foregroundStyle(Color.TS.textPrimary)
                                .padding(TSSpacing.md)
                                .frame(maxWidth: 280)
                                .presentationCompactAdaptation(.popover)
                        }
                    }
                }
                Text(verbatim: value)
                    .font(Font.TS.panel)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.accent.opacity(highlighted ? 0.6 : 0), lineWidth: 2)
        )
        .accessibilityElement(children: .combine)
    }
}
