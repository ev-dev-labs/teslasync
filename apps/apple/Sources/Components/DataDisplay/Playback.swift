import SwiftUI

/// Transport controls with keyboard shortcuts (web `PlaybackControls`).
public struct TSPlaybackControls: View {
    @Binding private var isPlaying: Bool
    private let onPrevious: () -> Void
    private let onNext: () -> Void

    public init(isPlaying: Binding<Bool>, onPrevious: @escaping () -> Void, onNext: @escaping () -> Void) {
        _isPlaying = isPlaying
        self.onPrevious = onPrevious
        self.onNext = onNext
    }

    public var body: some View {
        HStack(spacing: TSSpacing.lg) {
            Button(action: onPrevious) {
                Image(systemName: "backward.fill")
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.leftArrow, modifiers: [])
            .accessibilityLabel(Text("playback.previous"))

            Button {
                isPlaying.toggle()
            } label: {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill").font(.title2)
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.space, modifiers: [])
            .accessibilityLabel(Text(isPlaying ? "playback.pause" : "playback.play"))

            Button(action: onNext) {
                Image(systemName: "forward.fill")
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.rightArrow, modifiers: [])
            .accessibilityLabel(Text("playback.next"))
        }
        .foregroundStyle(Color.TS.textPrimary)
    }
}

/// Playback-speed picker menu (web `PlaybackSpeedMenu`).
public struct TSPlaybackSpeedMenu: View {
    @Binding private var speed: Double
    private let options: [Double]

    public init(speed: Binding<Double>, options: [Double] = [0.5, 1, 2, 4]) {
        _speed = speed
        self.options = options
    }

    public var body: some View {
        Menu {
            ForEach(options, id: \.self) { option in
                Button {
                    speed = option
                } label: {
                    if speed == option {
                        Label(Self.speedLabel(option), systemImage: "checkmark")
                    } else {
                        Text(verbatim: Self.speedLabel(option))
                    }
                }
            }
        } label: {
            Text(verbatim: Self.speedLabel(speed))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.accent)
        }
    }

    static func speedLabel(_ value: Double) -> String {
        String(format: "%gx", value)
    }
}

/// Timeline scrubber slider with a position readout (web `TimelineScrubber`).
public struct TSTimelineScrubber: View {
    @Binding private var progress: Double
    private let positionText: String

    public init(progress: Binding<Double>, positionText: String) {
        _progress = progress
        self.positionText = positionText
    }

    public var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Slider(value: $progress, in: 0 ... 1)
                .tint(Color.TS.accent)
                .accessibilityLabel(Text("playback.position"))
                .accessibilityValue(Text(verbatim: positionText))
            HStack {
                TSCode(positionText)
                Spacer()
            }
        }
    }
}
