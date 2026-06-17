import SwiftUI

// MARK: - Playback transport (web `PlaybackControls` + speed `Sparkline`)

/// The replay transport: a speed sparkline over a seek scrubber, the elapsed / total time labels,
/// the play-pause-stop buttons, and the speed-multiplier menu. Every control drives the shared
/// `TripsReplayModel` clock so the stats + charts stay in lockstep (web `controls.*`).
struct TripsReplayControlsSection: View {
    @Bindable var model: TripsReplayModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                sparkline
                scrubber
                transportRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("replay.controls.progress"))
    }

    // MARK: Speed sparkline (web `scrubberBackground` Sparkline)

    @ViewBuilder
    private var sparkline: some View {
        if model.speedSparkline.count > 1 {
            TSSparkline(values: model.speedSparkline, colorIndex: 0)
                .frame(height: 28)
                .accessibilityLabel(Text("replay.timeline.speed"))
        }
    }

    // MARK: Seek scrubber (web `onSeek` / `seekToProgress`)

    private var scrubber: some View {
        VStack(spacing: TSSpacing.xs) {
            Slider(
                value: Binding(
                    get: { model.progressFraction },
                    set: { model.seekTo(progress: $0) }
                ),
                in: 0 ... 1
            )
            .tint(Color.TS.accent)
            .accessibilityLabel(Text("replay.controls.progress"))
            HStack {
                Text(verbatim: TripsReplayModel.formatElapsed(model.elapsedMs))
                Spacer()
                Text(verbatim: TripsReplayModel.formatElapsed(model.totalTimeMs))
            }
            .font(Font.TS.caption)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textSecondary)
        }
    }

    // MARK: Transport buttons + speed menu (web play / pause / stop / setSpeed)

    private var transportRow: some View {
        HStack(spacing: TSSpacing.md) {
            Button(action: model.togglePlay) {
                Label(
                    model.isPlaying ? "replay.controls.pause" : "replay.controls.play",
                    systemImage: model.isPlaying ? "pause.fill" : "play.fill"
                )
                .labelStyle(.iconOnly)
                .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)

            Button(action: model.stop) {
                Label("replay.controls.stop", systemImage: "stop.fill")
                    .labelStyle(.iconOnly)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .disabled(model.currentIndex == 0 && !model.isPlaying)

            Spacer()
            speedMenu
        }
    }

    private var speedMenu: some View {
        Menu {
            ForEach(ReplaySpeed.allCases) { option in
                Button {
                    model.setSpeed(option)
                } label: {
                    if option == model.speed {
                        Label("\(option.multiplier)×", systemImage: "checkmark")
                    } else {
                        Text(verbatim: "\(option.multiplier)×")
                    }
                }
            }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Text("replay.controls.speed")
                Text(verbatim: "\(model.speed.multiplier)×").monospacedDigit()
            }
            .font(Font.TS.bodySm)
            .frame(minHeight: 44)
        }
        .accessibilityLabel(Text("replay.controls.speed"))
    }
}
