import Foundation
import Observation

// The `@Observable` state holder + render-ready value types for the `PresetGallery` parity
// surface (web `web/src/features/automations/pages/PresetGallery.tsx`). Owns the preset list
// (driving the gallery state) and the optional category filter. Data flows through the injected
// `PresetGalleryDataSource` whose method name mirrors the ported web hook verbatim — no
// networking in the view (ADR-004). The value types are pre-resolved (SF Symbol, trigger label
// key, action count) so the card view body holds no business logic.

// MARK: - Trigger kind (web `AutomationTriggerKind` + `triggerLabels`)

/// The four automation trigger kinds (web `AutomationTriggerKind`). The raw values keep the web
/// discriminator strings so a decoded API preset maps straight across; `labelKey` resolves the
/// `Localizable.xcstrings` subtitle (web `triggerLabels[kind]`).
public enum PresetTriggerKind: String, Sendable, Equatable, CaseIterable {
    case schedule = "trigger_schedule"
    case event = "trigger_event"
    case geofence = "trigger_geofence"
    case signal = "trigger_signal"

    /// `Localizable.xcstrings` key for the card subtitle (web `triggerLabels[kind].key`).
    public var labelKey: String {
        switch self {
        case .schedule: "automations.builder.triggerSchedule"
        case .event: "automations.builder.triggerEvent"
        case .geofence: "automations.builder.triggerGeofence"
        case .signal: "automations.builder.triggerSignal"
        }
    }
}

// MARK: - Preset category (web `AutomationPresetCategory`)

/// One preset category (web `AutomationPresetCategory` → `{ id, name, description, icon }`).
/// Part of the `useAutomationPresets` response contract; carried so the seam mirrors the API
/// shape even though the gallery grid itself renders presets.
public struct PresetGalleryCategory: Identifiable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let description: String
    public let icon: String

    public init(id: String, name: String, description: String, icon: String) {
        self.id = id
        self.name = name
        self.description = description
        self.icon = icon
    }
}

// MARK: - Preset item (web `AutomationPreset` fields the card renders)

/// One automation preset template (the web `AutomationPreset` fields the card renders): identity,
/// name, description, category, the icon discriminator, the first trigger's kind, and the action
/// count. Render-ready — `systemImage` resolves the web `iconMap`, `triggerLabelKey` resolves the
/// web trigger-label / no-trigger fallback — so the card view holds no logic.
public struct PresetGalleryItem: Identifiable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let description: String
    public let category: String
    public let icon: String
    public let triggerKind: PresetTriggerKind?
    public let actionCount: Int

    public init(
        id: String,
        name: String,
        description: String,
        category: String = "",
        icon: String = "Shield",
        triggerKind: PresetTriggerKind? = nil,
        actionCount: Int = 0
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.category = category
        self.icon = icon
        self.triggerKind = triggerKind
        self.actionCount = max(0, actionCount)
    }

    /// Web `iconMap[preset.icon] ?? Shield`, mapped to the nearest SF Symbol. Unknown icon
    /// discriminators fall back to the shield glyph (the web default).
    public var systemImage: String {
        switch icon {
        case "Shield": "shield.fill"
        case "Moon": "moon.fill"
        case "Sun": "sun.max.fill"
        case "ShieldCheck": "checkmark.shield.fill"
        case "Lock": "lock.fill"
        case "UserX": "person.fill.xmark"
        case "CarFront": "car.fill"
        case "Siren": "light.beacon.max.fill"
        default: "shield.fill"
        }
    }

    /// Web `triggers[0] ? triggerLabels[kind].key : 'automations.builder.noTrigger'`. A preset
    /// with no first trigger (or an unrecognized kind) resolves the no-trigger fallback.
    public var triggerLabelKey: String {
        triggerKind?.labelKey ?? "automations.builder.noTrigger"
    }
}

// MARK: - Response (web `AutomationPresetsResponse`)

/// The `useAutomationPresets` payload (web `AutomationPresetsResponse` → `{ categories, presets }`).
public struct PresetGalleryResponse: Sendable, Equatable {
    public let categories: [PresetGalleryCategory]
    public let presets: [PresetGalleryItem]

    public init(categories: [PresetGalleryCategory] = [], presets: [PresetGalleryItem] = []) {
        self.categories = categories
        self.presets = presets
    }
}

// MARK: - Data source seam (web hook, name kept at the Swift call site)

/// Supplies the preset catalog the gallery renders. The production implementation binds the shared
/// KMP repository / use-case (ADR-004); previews + tests inject doubles to drive the loading /
/// empty / success / error states. The method name mirrors the ported web hook verbatim so the
/// parity mapping is visible at the call site.
public protocol PresetGalleryDataSource: Sendable {
    /// web `useAutomationPresets(category)` → `GET /automations/presets{?category}`
    func useAutomationPresets(category: String?) async throws -> PresetGalleryResponse
}

// MARK: - Phase + gallery state (web `isLoading` + `presetList.length`)

/// The fetch phase driven by `useAutomationPresets`. `.error` is a retryable failure surfaced as a
/// distinct region (ADR-013 — never a blank gallery), an intentional enhancement over the web,
/// which renders its empty state when the query rejects.
public enum PresetGalleryLoadPhase: Sendable, Equatable {
    case loading
    case loaded
    case error(String)
}

/// The gallery render state the view switches on (web `isLoading ? skeletons : presetList.length
/// === 0 ? empty : cards`), plus the added retryable error case.
public enum PresetGalleryState: Sendable, Equatable {
    case loading
    case empty
    case success
    case error(String)
}

// MARK: - Page model

@MainActor
@Observable
public final class PresetGalleryModel {
    public private(set) var phase: PresetGalleryLoadPhase = .loading
    public private(set) var presets: [PresetGalleryItem] = []

    /// Web `category` prop forwarded to `useAutomationPresets(category)` as the query param.
    public let category: String?

    @ObservationIgnored private let dataSource: any PresetGalleryDataSource

    public init(
        category: String? = nil,
        dataSource: any PresetGalleryDataSource = SamplePresetGalleryDataSource()
    ) {
        self.category = category
        self.dataSource = dataSource
    }

    /// Web `presetList.map(...)` / loading / empty branch, collapsed into one render state.
    public var galleryState: PresetGalleryState {
        switch phase {
        case .loading: .loading
        case let .error(message): .error(message)
        case .loaded: presets.isEmpty ? .empty : .success
        }
    }

    /// Loads the preset catalog (driving the phase). Web initial `useAutomationPresets` fetch.
    public func load() async {
        phase = .loading
        await fetch()
    }

    /// Re-runs the load while keeping current content visible (web refetch / pull-to-refresh).
    public func refresh() async {
        await fetch()
    }

    private func fetch() async {
        do {
            let response = try await dataSource.useAutomationPresets(category: category)
            presets = response.presets
            phase = .loaded
        } catch {
            phase = .error(error.localizedDescription)
        }
    }
}
