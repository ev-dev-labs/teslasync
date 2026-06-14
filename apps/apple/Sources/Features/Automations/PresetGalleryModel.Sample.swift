import Foundation

/// A representative local seed used as the `PresetGallery` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production data — it is an
/// API-response-shaped fixture (the product's quick-start preset catalog spanning all four trigger
/// kinds and several icon discriminators) so the surface renders its populated success state out of
/// the box, mirroring the sibling pages' sample sources.
public struct SamplePresetGalleryDataSource: PresetGalleryDataSource {
    public init() {}

    public func useAutomationPresets(category: String?) async throws -> PresetGalleryResponse {
        let presets = Self.samplePresets.filter { preset in
            guard let category, !category.isEmpty else { return true }
            return preset.category == category
        }
        return PresetGalleryResponse(categories: Self.sampleCategories, presets: presets)
    }

    private static let sampleCategories: [PresetGalleryCategory] = [
        PresetGalleryCategory(
            id: "comfort",
            name: "Comfort",
            description: "Cabin comfort routines",
            icon: "Sun"
        ),
        PresetGalleryCategory(
            id: "security",
            name: "Security",
            description: "Keep the vehicle protected",
            icon: "Shield"
        ),
        PresetGalleryCategory(
            id: "energy",
            name: "Energy",
            description: "Charging + battery care",
            icon: "Moon"
        )
    ]

    private static let samplePresets: [PresetGalleryItem] = [
        PresetGalleryItem(
            id: "departure-precondition",
            name: "Departure Preconditioning",
            description: "Warm or cool the cabin before your scheduled weekday departure.",
            category: "comfort",
            icon: "Sun",
            triggerKind: .schedule,
            actionCount: 2
        ),
        PresetGalleryItem(
            id: "smart-charge-limit",
            name: "Smart Charge Limit",
            description: "Cap charging at 80% on weeknights for long-term battery longevity.",
            category: "energy",
            icon: "Moon",
            triggerKind: .schedule,
            actionCount: 1
        ),
        PresetGalleryItem(
            id: "arrive-home-security",
            name: "Arrive Home Security",
            description: "Disable Sentry and unlock the doors when you reach the home geofence.",
            category: "security",
            icon: "ShieldCheck",
            triggerKind: .geofence,
            actionCount: 2
        ),
        PresetGalleryItem(
            id: "low-battery-alert",
            name: "Low Battery Alert",
            description: "Send a push notification when the charge level drops below 20%.",
            category: "energy",
            icon: "Siren",
            triggerKind: .signal,
            actionCount: 1
        ),
        PresetGalleryItem(
            id: "sentry-on-park",
            name: "Sentry On Departure",
            description: "Enable Sentry Mode automatically whenever you park away from home.",
            category: "security",
            icon: "CarFront",
            triggerKind: .event,
            actionCount: 1
        ),
        PresetGalleryItem(
            id: "overnight-lock",
            name: "Overnight Lock Check",
            description: "Lock the doors and close the windows at a fixed time every night.",
            category: "security",
            icon: "Lock",
            triggerKind: .schedule,
            actionCount: 3
        )
    ]
}

#if DEBUG
    /// Preview/test seam yielding zero presets — drives the gallery's empty state (web
    /// `presetList.length === 0`).
    public struct EmptyPresetGalleryDataSource: PresetGalleryDataSource {
        public init() {}

        public func useAutomationPresets(category _: String?) async throws -> PresetGalleryResponse {
            PresetGalleryResponse()
        }
    }

    /// Preview/test seam whose `useAutomationPresets` load fails — drives the gallery error state.
    public struct FailingPresetGalleryDataSource: PresetGalleryDataSource {
        public struct Failure: Error {}
        public init() {}

        public func useAutomationPresets(category _: String?) async throws -> PresetGalleryResponse {
            throw Failure()
        }
    }
#endif
