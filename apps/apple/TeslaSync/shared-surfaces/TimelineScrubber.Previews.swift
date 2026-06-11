//
//  TimelineScrubber.Previews.swift
//  TeslaSync — P4 shared surface · 0107 · TimelineScrubber (Apple)
//
//  Xcode previews for every presentation form the web source supports plus the P4 leaf states: the
//  interactive track (keyframe markers + a decorative speed background + a scrub-preview sampler), the
//  loading skeleton track, the empty "nothing to scrub" state, the error row, and the stale / offline
//  freshness chip + banner. Staged on the app background. DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private enum TimelineScrubberPreviewData {
        static let markers: [TimelineScrubberMarker] = [
            TimelineScrubberMarker(at: 0, kind: .start, label: "Departed"),
            TimelineScrubberMarker(at: 0.22, kind: .fastSegment, label: "Fast segment"),
            TimelineScrubberMarker(at: 0.41, kind: .regenPeak, label: "Regen peak", count: 3),
            TimelineScrubberMarker(at: 0.68, kind: .lowSoc, label: "Low battery"),
            TimelineScrubberMarker(at: 1, kind: .stop, label: "Arrived")
        ]

        static func content(connection: TimelineScrubberConnection = .live) -> TimelineScrubberInput {
            TimelineScrubberInput(
                progress: 0.41,
                buffered: 0.6,
                durationSeconds: 372,
                markers: markers,
                connection: connection
            )
        }

        static let sampler: @MainActor (Double) -> TimelineScrubberPreview? = { at in
            TimelineScrubberPreview(
                at: at,
                speed: "\(Int(at * 80)) mph",
                power: "\(Int(at * 120)) kW",
                soc: "\(max(0, 86 - Int(at * 40)))%"
            )
        }

        static var background: AnyView {
            AnyView(TimelineScrubberSparklinePreview())
        }
    }

    /// A tiny decorative speed sparkline standing in for the host's `<Sparkline>` background.
    private struct TimelineScrubberSparklinePreview: View {
        private let samples: [Double] = [0.2, 0.5, 0.4, 0.8, 0.6, 0.9, 0.7, 0.95, 0.5, 0.3]

        var body: some View {
            GeometryReader { geo in
                Path { path in
                    let step = geo.size.width / CGFloat(max(1, samples.count - 1))
                    for (index, sample) in samples.enumerated() {
                        let point = CGPoint(x: CGFloat(index) * step, y: geo.size.height * (1 - sample))
                        if index == 0 {
                            path.move(to: point)
                        } else {
                            path.addLine(to: point)
                        }
                    }
                }
                .stroke(Color.TS.accent, lineWidth: 2)
            }
        }
    }

    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .padding()
            .frame(maxWidth: 620, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Content — full") {
        staged(TimelineScrubber(
            input: TimelineScrubberPreviewData.content(),
            preview: TimelineScrubberPreviewData.sampler,
            background: TimelineScrubberPreviewData.background
        ))
    }

    #Preview("Content — minimal") {
        staged(TimelineScrubber(input: TimelineScrubberInput(progress: 0.3, durationSeconds: 200)))
    }

    #Preview("Loading") {
        staged(TimelineScrubber(input: TimelineScrubberInput(isLoading: true)))
    }

    #Preview("Empty") {
        staged(TimelineScrubber(input: TimelineScrubberInput(durationSeconds: 0)))
    }

    #Preview("Error") {
        staged(TimelineScrubber(input: TimelineScrubberInput(errorMessage: "Could not load replay")))
    }

    #Preview("Stale") {
        staged(TimelineScrubber(
            input: TimelineScrubberPreviewData.content(connection: .stale),
            preview: TimelineScrubberPreviewData.sampler,
            background: TimelineScrubberPreviewData.background
        ))
    }

    #Preview("Offline") {
        staged(TimelineScrubber(
            input: TimelineScrubberPreviewData.content(connection: .offline),
            preview: TimelineScrubberPreviewData.sampler
        ))
    }
#endif
