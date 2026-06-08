//
//  FeatureToggles.Previews.swift
//  TeslaSync — P4 feature view · 0205 · FeatureToggles (Apple)
//
//  Xcode previews — one per state the surface produces: content (mixed primitive +
//  object feature values, with details), empty (resolved, no config → web
//  `EmptyState`), loading (initial skeleton chrome), error (fetch failed → retry),
//  and the stale / offline freshness variants. Preview-only; excluded from release
//  builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentFeatureTogglesTelemetry: FeatureTogglesTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op toast sink so previews don't surface toasts.
    private struct SilentFeatureTogglesToast: FeatureTogglesToast {
        func success(message _: String) {}
        func error(message _: String, detail _: String?) {}
    }

    /// Sample feature config (web `featureConfig.data`) exercising every branch:
    /// object-with-details, object enabled/disabled, and bare primitive values.
    private enum FeatureTogglesPreviewData {
        static let config: [String: FeatureConfigValue] = [
            "BIDIRECTIONAL_CHARGING": .object(["enabled": .bool(false)]),
            "ENDPOINTS": .object([
                "enabled": .bool(true),
                "VEHICLE_DATA": .string("api/1/vehicles/{id}/vehicle_data"),
                "max_calls": .number(200)
            ]),
            "MOBILE_ACCESS": .bool(true),
            "SCHEDULED_CHARGING": .number(0),
            "REGION": .string("NA")
        ]

        static var fetchedAt: Date {
            Date(timeIntervalSince1970: 1_733_600_700)
        }
    }

    @MainActor
    private func featureTogglesPreview(_ update: FeatureTogglesUpdate) -> FeatureToggles {
        FeatureToggles(
            model: FeatureTogglesModel(
                source: InMemoryFeatureTogglesSource(initial: update),
                telemetry: SilentFeatureTogglesTelemetry(),
                toast: SilentFeatureTogglesToast()
            )
        )
    }

    #Preview("Content") {
        featureTogglesPreview(
            FeatureTogglesUpdate(
                status: .loaded,
                config: FeatureTogglesPreviewData.config,
                fetchedAt: FeatureTogglesPreviewData.fetchedAt
            )
        )
        .padding()
        .frame(maxWidth: 620)
    }

    #Preview("Empty") {
        featureTogglesPreview(FeatureTogglesUpdate(status: .empty, config: [:]))
            .padding()
            .frame(maxWidth: 620)
    }

    #Preview("Loading") {
        featureTogglesPreview(FeatureTogglesUpdate(status: .loading))
            .padding()
            .frame(maxWidth: 620)
    }

    #Preview("Error") {
        featureTogglesPreview(FeatureTogglesUpdate(status: .failed("Request timed out")))
            .padding()
            .frame(maxWidth: 620)
    }

    #Preview("Stale") {
        featureTogglesPreview(
            FeatureTogglesUpdate(
                status: .loaded,
                connection: .stale,
                config: FeatureTogglesPreviewData.config,
                fetchedAt: FeatureTogglesPreviewData.fetchedAt
            )
        )
        .padding()
        .frame(maxWidth: 620)
    }

    #Preview("Offline") {
        featureTogglesPreview(
            FeatureTogglesUpdate(
                status: .loaded,
                connection: .offline,
                config: FeatureTogglesPreviewData.config,
                fetchedAt: FeatureTogglesPreviewData.fetchedAt
            )
        )
        .padding()
        .frame(maxWidth: 620)
    }
#endif
