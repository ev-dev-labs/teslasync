//
//  AIFeatureToggleList.RegistryTests.swift
//  TeslaSync — P4 feature view · 0199 · AIFeatureToggleList (Apple)
//
//  Registry + i18n-catalogue coverage for the AI feature-toggle surface, split from the main
//  AIFeatureToggleList.Tests.swift so each test file stays within the file-length budget:
//    • Registry — count / web-order parity (vs AI_FEATURE_IDS) / unique ids / non-empty names.
//    • Catalogue — the shipped `.strings` carries a non-empty label (== registry name) + description
//      for every feature id, plus the legend. This pins the long descriptions, which live in the i18n
//      table (not as Swift literals), so parity of the per-feature blurbs is verified end-to-end.
//
//  `expectedFeatureIDs` is module-internal so the projector tests in the sibling file share the single
//  canonical ordering. These run in the TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Expected registry order (web AI_FEATURE_IDS, verbatim)

/// The canonical AI feature order, copied verbatim from `AI_FEATURE_IDS` in web/src/ai/features.ts.
/// Module-internal so both this file and AIFeatureToggleList.Tests.swift assert against one source.
let expectedFeatureIDs: [String] = [
    "__redaction_bypass__",
    "__usage__",
    "ai-provider-health",
    "alert-tuning-suggestions",
    "anomaly-explanations",
    "auto-name-unnamed-locations",
    "auto-trip-naming",
    "battery-health-forecast-narrative",
    "cabin-temperature-impact-narrative",
    "charging-curve-fingerprint-clustering",
    "charging-diagnosis",
    "chatbot-llm",
    "cost-forecast-narration",
    "cross-rule-conflict-detection",
    "data-repair-suggestions",
    "digest-narration",
    "drive-coaching",
    "feedback-queue-triage",
    "geofence-aware-automation-suggestions",
    "inbox-auto-categorization",
    "incident-timeline-summarizer",
    "learned-per-vehicle-anomaly-baselines",
    "lifetime-stats-qa",
    "log-trace-summarization",
    "ml-charging-curve-clustering",
    "mqtt-sse-inspector-explanations",
    "nl-alert-builder",
    "nl-automation-builder",
    "nl-dashboard-composer",
    "nl-drive-search-replay",
    "nl-grafana-panel",
    "nl-search",
    "nl-sql-playground",
    "period-compare-narration",
    "pii-redaction-shared-exports",
    "predictive-maintenance",
    "preheat-precool-recommender",
    "quiet-hours-suggestion",
    "rag-help",
    "range-prediction-model",
    "route-efficiency-suggestions",
    "safety-setting-explainer",
    "signal-explorer-nl-filter",
    "smart-charge-schedule-suggestion",
    "software-update-changelog-summarizer",
    "speed-profile-insights",
    "state-machine-debugger-narrator",
    "suggest-new-geofences",
    "tco-narration",
    "tire-pressure-trend-reasoning",
    "trip-planner-llm-agent",
    "trip-postcard-share-card-image-generation",
    "vampire-drain-explanation",
    "vehicle-paint-preview",
    "voice-mode",
    "watch-face-nl-response",
    "yir-narration"
]

// MARK: - Registry: count / order / ids / names

final class AIFeatureRegistryTests: XCTestCase {
    func testRegistryHasEveryFeature() {
        XCTAssertEqual(AIFeatureRegistry.all.count, 57)
        XCTAssertEqual(AIFeatureRegistry.all.count, expectedFeatureIDs.count)
    }

    func testRegistryOrderMatchesWebAIFeatureIDs() {
        XCTAssertEqual(AIFeatureRegistry.all.map(\.id), expectedFeatureIDs)
    }

    func testRegistryIdsAreUnique() {
        XCTAssertEqual(Set(AIFeatureRegistry.all.map(\.id)).count, AIFeatureRegistry.all.count)
    }

    func testRegistryNamesAreNonEmpty() {
        for descriptor in AIFeatureRegistry.all {
            XCTAssertFalse(descriptor.name.isEmpty, "empty name for \(descriptor.id)")
        }
    }
}

// MARK: - Catalogue completeness (the shipped .strings carries every label + description)

final class AIFeatureToggleCatalogTests: XCTestCase {
    /// Loads the per-surface `.strings` table sitting next to this test file (works in both the Xcode
    /// target and the host harness, which copies the table alongside the sources).
    private func loadCatalog(file: StaticString = #filePath) throws -> [String: String] {
        let testURL = URL(fileURLWithPath: "\(file)")
        let stringsURL = testURL
            .deletingLastPathComponent()
            .appendingPathComponent("AIFeatureToggleList.strings")
        let dict = NSDictionary(contentsOf: stringsURL) as? [String: String]
        return try XCTUnwrap(dict, "could not parse \(stringsURL.lastPathComponent)")
    }

    func testLegendKeyPresent() throws {
        let catalog = try loadCatalog()
        XCTAssertEqual(catalog["ai.settings.feature.legend"], "Per-feature opt-in (all default off)")
    }

    func testEveryFeatureHasLabelMatchingRegistryName() throws {
        let catalog = try loadCatalog()
        for descriptor in AIFeatureRegistry.all {
            let value = catalog["ai.settings.feature.\(descriptor.id).label"]
            XCTAssertEqual(value, descriptor.name, "label mismatch for \(descriptor.id)")
        }
    }

    func testEveryFeatureHasNonEmptyDescription() throws {
        let catalog = try loadCatalog()
        for descriptor in AIFeatureRegistry.all {
            let value = catalog["ai.settings.feature.\(descriptor.id).description"] ?? ""
            XCTAssertFalse(value.isEmpty, "missing/empty description for \(descriptor.id)")
        }
    }
}
