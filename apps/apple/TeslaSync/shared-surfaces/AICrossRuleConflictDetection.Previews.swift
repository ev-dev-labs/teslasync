//
//  AICrossRuleConflictDetection.Previews.swift
//  TeslaSync — P4 shared surface · 0014 · AICrossRuleConflictDetection (Apple)
//
//  Xcode previews for each surface state (idle / streaming / conflicts / empty / stream-error /
//  gate-loading / gate-error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: RuleConflictInput,
        configure: ((RuleConflictModel, InMemoryRuleConflictSource) -> Void)? = nil
    ) -> RuleConflictModel {
        let source = InMemoryRuleConflictSource(initial: input)
        let model = RuleConflictModel(source: source, onReview: { _ in })
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = RuleConflictInput(gate: .on, ruleIDs: [11, 12, 13], vehicleID: 7)

    private let sampleConflicts: [RuleConflict] = [
        RuleConflict(
            kind: RuleConflictKind.redundantDuplicate,
            ruleAID: 11,
            ruleBID: 12,
            ruleAName: "Low battery",
            ruleBName: "Battery below 20%",
            signalName: "battery_level",
            reason: "Both alert on the same signal with identical thresholds.",
            subsumes: true
        ),
        RuleConflict(
            kind: RuleConflictKind.overlappingThreshold,
            ruleAID: 12,
            ruleBID: 13,
            ruleAName: "Cabin too hot",
            ruleBName: "Overheat warning",
            signalName: "cabin_temp",
            reason: "Overlapping trigger windows with conflicting severities.",
            severityMismatch: true,
            cooldownMismatch: true,
            triggerModeMismatch: true
        )
    ]

    #Preview("Idle / invite") {
        AICrossRuleConflictDetection(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AICrossRuleConflictDetection(model: previewModel(readyInput) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Conflicts") {
        AICrossRuleConflictDetection(model: previewModel(readyInput) { _, source in
            source.pushConflicts(sampleConflicts)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty / no conflicts") {
        AICrossRuleConflictDetection(model: previewModel(readyInput) { _, source in
            source.pushConflicts([])
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AICrossRuleConflictDetection(model: previewModel(readyInput) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AICrossRuleConflictDetection(model: previewModel(
            RuleConflictInput(gate: .loading, ruleIDs: [11, 12])
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AICrossRuleConflictDetection(model: previewModel(
            RuleConflictInput(gate: .loading, ruleIDs: [11, 12], errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AICrossRuleConflictDetection(model: previewModel(
            RuleConflictInput(gate: .on, ruleIDs: [11, 12, 13], connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AICrossRuleConflictDetection(model: previewModel(
            RuleConflictInput(gate: .on, ruleIDs: [11, 12, 13], connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
