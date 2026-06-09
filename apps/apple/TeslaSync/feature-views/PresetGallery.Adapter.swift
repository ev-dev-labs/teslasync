//
//  PresetGallery.Adapter.swift
//  TeslaSync — P4 feature view · 0085 · AutomationPresetGallery (Apple)
//
//  The testable projection core for the automation AutomationPresetGallery — a faithful port of
//  the data shapes + pure logic in features/automations/pages/PresetGallery.tsx: the
//  `AutomationPreset` card model, the `iconMap` (Lucide → SF Symbols, defaulting to the
//  web `?? Shield`), the `triggerLabels` map keyed by the first trigger's kind (web
//  `triggers[0].kind`), the "{{count}} actions" badge interpolation (web i18next
//  `t(..., { count })`), and the load → render-phase resolution. Pure + SwiftUI-free,
//  so it unit-tests without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web page has three branches — loading (four `PresetCardSkeleton`s), empty
//      (`presetList.length === 0` → `EmptyState`), and loaded (`FadeIn` >
//      `StaggerContainer` of `PresetCard`s). `resolvePhase` reproduces that, widened
//      with the prompt-required error envelope so a first-load failure is never a blank
//      box, and the stale / offline freshness branches the live-state contract adds.
//    • The browser/OS-free icon + trigger names are product strings; only the
//      "{{count}} actions" template, the trigger labels, the no-trigger fallback, and
//      the empty copy resolve through the injected P1/S10 localizer, so the view holds
//      no hardcoded English.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the
/// dependency-free core so the projection's unit tests can reach it.
public enum AutomationPresetGallerySurface {
    public static let slug = "PresetGallery"
}

// MARK: - Trigger kind (web `AutomationTriggerKind` + `triggerLabels`)

/// The four automation trigger kinds (web `AutomationTriggerKind`). The raw values are
/// the wire discriminators (web `trigger_schedule` …); `labelKey` / `labelFallback`
/// reproduce the web `triggerLabels` map so the card's subtitle localizes identically.
public enum AutomationTriggerKind: String, Sendable, Equatable, CaseIterable {
    case schedule = "trigger_schedule"
    case event = "trigger_event"
    case geofence = "trigger_geofence"
    case signal = "trigger_signal"

    /// The P1/S10 key for the trigger's label (web `triggerLabels[kind].key`).
    public var labelKey: String {
        switch self {
        case .schedule: "automations.builder.triggerSchedule"
        case .event: "automations.builder.triggerEvent"
        case .geofence: "automations.builder.triggerGeofence"
        case .signal: "automations.builder.triggerSignal"
        }
    }

    /// The English fallback for the trigger's label (web `triggerLabels[kind].fallback`).
    public var labelFallback: String {
        switch self {
        case .schedule: "Schedule"
        case .event: "Vehicle Event"
        case .geofence: "Geofence"
        case .signal: "Signal Threshold"
        }
    }

    /// Parses a wire discriminator into a kind, ignoring unknown values (web reads
    /// `triggers[0].kind` and only the four kinds carry a label).
    public init?(wire: String) {
        self.init(rawValue: wire)
    }
}

// MARK: - Preset card model (web `AutomationPreset`)

/// One automation preset template — the native parity of the web `AutomationPreset`
/// fields the card renders (id, name, description, icon, the trigger list, and the
/// action count). The first trigger's kind drives the subtitle (web `triggers[0]`),
/// and `actionCount` is the web `actions.length`.
public struct AutomationPresetItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let summary: String
    public let iconKey: String
    public let triggers: [AutomationTriggerKind]
    public let actionCount: Int

    public init(
        id: String,
        name: String,
        summary: String,
        iconKey: String,
        triggers: [AutomationTriggerKind],
        actionCount: Int
    ) {
        self.id = id
        self.name = name
        self.summary = summary
        self.iconKey = iconKey
        self.triggers = triggers
        self.actionCount = actionCount
    }

    /// The first configured trigger's kind (web `preset.triggers[0]`), or `nil` when the
    /// preset has no triggers (web `firstTrigger` falsy → the no-trigger label).
    public var firstTriggerKind: AutomationTriggerKind? {
        triggers.first
    }

    /// The SF Symbol for the preset's icon (web `iconMap[preset.icon] ?? Shield`).
    public var symbolName: String {
        AutomationPresetGalleryProjection.symbolName(forIcon: iconKey)
    }
}

// MARK: - Render phase / load status / freshness

/// What the surface should render at the top level. The web splits loading / empty /
/// loaded; the error envelope is added so a first-load failure with nothing cached is
/// never a blank panel.
public enum AutomationPresetGalleryPhase: Sendable, Equatable {
    case loading
    case error(String)
    case empty
    case content
}

/// The bound source's load status for the presets query (web `isLoading` / resolved /
/// failure).
public enum AutomationPresetGalleryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner
/// so a cached list is clearly labeled while reconnecting / offline.
public enum AutomationPresetGalleryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free resolution from the bound source's load status + item count to
/// the top-level render phase, plus the trigger-label / action-count / icon mappings the
/// card renders, each a faithful port of the web `PresetGallery` logic.
public enum AutomationPresetGalleryProjection {
    /// Resolves the render phase. Cached items survive a refresh / failure (freshness is
    /// shown by the banner); loading shows only before the first items arrive; a resolved
    /// empty list shows the empty state; a failure with no cached items shows the error.
    public static func resolvePhase(
        status: AutomationPresetGalleryLoadStatus,
        itemCount: Int
    ) -> AutomationPresetGalleryPhase {
        let hasItems = itemCount > 0
        switch status {
        case .loading:
            return hasItems ? .content : .loading
        case .loaded:
            return hasItems ? .content : .empty
        case let .failed(message):
            return hasItems ? .content : .error(message)
        }
    }

    /// The card subtitle: the first trigger's label, or the no-trigger fallback when the
    /// preset has none (web `triggerLabel ? t(label) : t('…noTrigger', 'No trigger…')`).
    public static func triggerLabel(
        for kind: AutomationTriggerKind?,
        localize: (String, String) -> String
    ) -> String {
        guard let kind else {
            return localize("automations.builder.noTrigger", "No trigger configured")
        }
        return localize(kind.labelKey, kind.labelFallback)
    }

    /// The action-count badge (web `t('…actionCount', '{{count}} actions', { count })`),
    /// interpolating the count into the localized template.
    public static func actionCountLabel(
        count: Int,
        localize: (String, String) -> String
    ) -> String {
        localize("automations.presets.actionCount", "{{count}} actions")
            .replacingOccurrences(of: "{{count}}", with: String(count))
    }

    /// The Install-button accessibility label (web button text + the preset name for
    /// VoiceOver), interpolating the name into the localized template.
    public static func installLabel(
        name: String,
        localize: (String, String) -> String
    ) -> String {
        localize("automations.presets.installAria", "Install {{name}}")
            .replacingOccurrences(of: "{{name}}", with: name)
    }

    /// Maps the web `iconMap` (Lucide names) to SF Symbols, defaulting to the shield
    /// glyph for any unmapped key (web `iconMap[preset.icon] ?? Shield`).
    public static func symbolName(forIcon iconKey: String) -> String {
        iconSymbols[iconKey] ?? "shield.fill"
    }

    /// The web `iconMap` keys → SF Symbols. Browser-agnostic, product-stable.
    private static let iconSymbols: [String: String] = [
        "Shield": "shield.fill",
        "Moon": "moon.fill",
        "Sun": "sun.max.fill",
        "ShieldCheck": "checkmark.shield.fill",
        "Lock": "lock.fill",
        "UserX": "person.fill.xmark",
        "CarFront": "car.fill",
        "Siren": "light.beacon.max.fill"
    ]
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// so the summaries are testable without a bundle.
public enum AutomationPresetGalleryAccessibility {
    /// The gallery summary: title + preset count.
    public static func gallerySummary(count: Int, localize: (String, String) -> String) -> String {
        let title = localize("automations.presets.title", "Automation presets")
        return "\(title): \(count)"
    }

    /// One card's VoiceOver label: name · trigger label · action count, each resolved
    /// through the same facade the card renders with.
    public static func cardLabel(
        _ item: AutomationPresetItem,
        localize: (String, String) -> String
    ) -> String {
        let trigger = AutomationPresetGalleryProjection.triggerLabel(for: item.firstTriggerKind, localize: localize)
        let actions = AutomationPresetGalleryProjection.actionCountLabel(count: item.actionCount, localize: localize)
        return [item.name, trigger, actions].joined(separator: ", ")
    }
}
