//
//  ScoreBadge.Previews.swift
//  TeslaSync — P4 shared surface · 0103 · ScoreBadge (Apple)
//
//  Xcode previews for each surface state (loading / unavailable / the A+…F grade glyphs / the empty
//  "—" readout / stale / offline) plus the size variants. DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: ScoreBadgeInput,
        config: ScoreBadgeConfig = .default
    ) -> ScoreBadgeModel {
        let source = InMemoryScoreBadgeSource(initial: input)
        let model = ScoreBadgeModel(source: source, config: config)
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: ScoreBadgeModel) -> some View {
        ScoreBadge(model: model)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        staged(previewModel(ScoreBadgeInput(status: .loading)))
    }

    #Preview("Unavailable") {
        staged(previewModel(ScoreBadgeInput(status: .failed)))
    }

    #Preview("Grades (A+ → F)") {
        HStack(spacing: TSSpacing.lg) {
            ForEach(ScoreBadgeGrade.allCases, id: \.self) { grade in
                ScoreBadge(model: previewModel(
                    ScoreBadgeInput(status: .resolved, value: .grade(grade)),
                    config: ScoreBadgeConfig(size: .large)
                ))
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Numeric score (87 → B)") {
        staged(previewModel(ScoreBadgeInput(status: .resolved, value: .score(87))))
    }

    #Preview("Empty (— / null score)") {
        staged(previewModel(ScoreBadgeInput(status: .resolved, value: .score(nil))))
    }

    #Preview("Sizes (sm / md / lg)") {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.lg) {
            ForEach(ScoreBadgeSize.allCases, id: \.self) { size in
                ScoreBadge(model: previewModel(
                    ScoreBadgeInput(status: .resolved, value: .grade(.aGrade)),
                    config: ScoreBadgeConfig(size: size)
                ))
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Stale (auto-refresh)") {
        staged(previewModel(ScoreBadgeInput(status: .resolved, value: .score(72), stale: true)))
    }

    #Preview("Offline (cached)") {
        staged(previewModel(ScoreBadgeInput(status: .resolved, value: .score(91), offline: true)))
    }
#endif
