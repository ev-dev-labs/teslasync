//
//  AiOutputPanel.Previews.swift
//  TeslaSync — P4 shared surface · 0036 · AiOutputPanel (Apple)
//
//  Xcode previews for each render branch (pending / streaming-with-text / answer / error with a
//  message / error resolving to "unknown" / custom pending content / omitted pending content /
//  hidden). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private let sampleAnswer = """
    Across the life of this vehicle you've driven 48,210 km over 1,204 drives.

    You've added 11.6 MWh across 318 charging sessions, saving roughly $5,940 versus petrol — \
    and unlocked 14 achievements, including a 612 km single-day record.
    """

    #Preview("Pending / thinking") {
        AiOutputPanel(text: "", state: .streaming)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming with text") {
        AiOutputPanel(text: "Across the life of this vehicle you've driven 48,210 km", state: .streaming)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Answer") {
        AiOutputPanel(text: sampleAnswer, state: .done)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error / message") {
        AiOutputPanel(
            text: "",
            state: .error,
            error: "Helix is rate-limited. Try again in 30s."
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error / unknown") {
        AiOutputPanel(text: "", state: .error, error: nil)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Custom pending content") {
        AiOutputPanel(text: "", state: .streaming) {
            HStack(spacing: TSSpacing.xs) {
                ProgressView()
                Text(verbatim: "Summarising your drives…")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Omitted pending content") {
        AiOutputPanel(text: "", state: .streaming) { EmptyView() }
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Hidden (idle)") {
        VStack(spacing: TSSpacing.sm) {
            Text(verbatim: "Nothing streamed yet — the panel renders nothing:")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            AiOutputPanel(text: "", state: .idle)
        }
        .padding()
        .background(Color.TS.bg)
    }
#endif
