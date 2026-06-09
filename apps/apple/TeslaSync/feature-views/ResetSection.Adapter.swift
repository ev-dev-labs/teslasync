//
//  ResetSection.Adapter.swift
//  TeslaSync — P4 feature view · 0212 · ResetSection (Apple)
//
//  The pure, dependency-free projection core for the Reset-to-defaults surface — the
//  SwiftUI-agnostic parity of web/src/features/settings/components/ResetSection.tsx. It
//  carries the canonical resettable-section catalog (web `useSectionRows`) and the
//  read-only deny-list (web `useDeniedRows`), the render-phase resolution, the
//  status-banner projection (the P4 states contract), the success-toast detail counter
//  (web `t('settingsReset.toasts.successDetail', { count, sections })`), the typed
//  "RESET" confirmation predicate (web `requireTypedConfirmation="RESET"`), the confirm
//  title/message templating (web `Reset {{name}}?` / `{{description}} …`), the per-control
//  disabled predicates, and the VoiceOver summaries. Everything is pure + Foundation-only
//  so it can be unit-tested without a store, a bundle, or a rendered view.
//

import Foundation

// MARK: - Localizer shape (web `t(key, default)`)

/// The localizer the projection takes — the web `t(key, default)` reduced to its two
/// arguments, so the pure core never imports the bundle facade.
public typealias ResetLocalize = (String, String) -> String

// MARK: - Section + denied domain (web `SectionRow` / `DeniedRow`)

/// One resettable section row (web `SectionRow`): a stable lower-snake-case id (the
/// canonical name from `database.AllSettingsResetSections()`), the title + description
/// key/fallback pair (web `t(key, default)`), and the SF Symbol that replaces the web
/// lucide glyph. Pure data so it round-trips through the P1/S8 source seam untouched.
public struct ResetSectionRow: Identifiable, Sendable, Equatable {
    public let id: String
    public let systemImage: String
    public let titleKey: String
    public let titleFallback: String
    public let descriptionKey: String
    public let descriptionFallback: String

    public init(
        id: String,
        systemImage: String,
        titleKey: String,
        titleFallback: String,
        descriptionKey: String,
        descriptionFallback: String
    ) {
        self.id = id
        self.systemImage = systemImage
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.descriptionKey = descriptionKey
        self.descriptionFallback = descriptionFallback
    }

    /// The localized title (web `row.title`).
    public func title(_ localize: ResetLocalize) -> String {
        localize(titleKey, titleFallback)
    }

    /// The localized description (web `row.description`).
    public func description(_ localize: ResetLocalize) -> String {
        localize(descriptionKey, descriptionFallback)
    }
}

/// One read-only deny-list row (web `DeniedRow`): a section the Settings surface cannot
/// reset, plus the reason + the alternative path the user should take.
public struct ResetDeniedRow: Identifiable, Sendable, Equatable {
    public let id: String
    public let titleKey: String
    public let titleFallback: String
    public let reasonKey: String
    public let reasonFallback: String

    public init(id: String, titleKey: String, titleFallback: String, reasonKey: String, reasonFallback: String) {
        self.id = id
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.reasonKey = reasonKey
        self.reasonFallback = reasonFallback
    }

    /// The localized title (web `row.title`).
    public func title(_ localize: ResetLocalize) -> String {
        localize(titleKey, titleFallback)
    }

    /// The localized reason (web `row.reason`).
    public func reason(_ localize: ResetLocalize) -> String {
        localize(reasonKey, reasonFallback)
    }
}

// MARK: - Canonical catalog (web `useSectionRows` / `useDeniedRows`)

/// The canonical resettable-section allowlist + the deny-list, kept verbatim from the web
/// source so production (which hydrates them from the backend section registry), previews,
/// and tests share one fallback spec. The strings match `ResetSection.strings` 1:1.
public enum ResetCatalog {
    /// The eight allowlisted, user-resettable sections (web `useSectionRows`), in the
    /// exact order the web list renders them.
    public static let defaultSections: [ResetSectionRow] = [
        ResetSectionRow(
            id: "general",
            systemImage: "gearshape.fill",
            titleKey: "settingsReset.section.general.title",
            titleFallback: "General preferences",
            descriptionKey: "settingsReset.section.general.desc",
            descriptionFallback: "Units, language, currency, timezone, and energy/gas pricing defaults."
        ),
        ResetSectionRow(
            id: "appearance",
            systemImage: "paintpalette.fill",
            titleKey: "settingsReset.section.appearance.title",
            titleFallback: "Appearance",
            descriptionKey: "settingsReset.section.appearance.desc",
            descriptionFallback: "Theme, density, chart palette, and notification badge / flash preferences."
        ),
        ResetSectionRow(
            id: "alert_rules",
            systemImage: "bell.fill",
            titleKey: "settingsReset.section.alertRules.title",
            titleFallback: "Alert rules",
            descriptionKey: "settingsReset.section.alertRules.desc",
            descriptionFallback: "Delete every alert rule you have authored. Cannot be undone."
        ),
        ResetSectionRow(
            id: "geofences",
            systemImage: "mappin.and.ellipse",
            titleKey: "settingsReset.section.geofences.title",
            titleFallback: "Geofences",
            descriptionKey: "settingsReset.section.geofences.desc",
            descriptionFallback: "Delete every geofence and its electricity-rate overrides. "
                + "Vehicle home assignments will be cleared."
        ),
        ResetSectionRow(
            id: "notification_channels",
            systemImage: "bell.badge.fill",
            titleKey: "settingsReset.section.notificationChannels.title",
            titleFallback: "Notification channels",
            descriptionKey: "settingsReset.section.notificationChannels.desc",
            descriptionFallback: "Delete every webhook, Discord, Slack, email, and push channel "
                + "along with their delivery history."
        ),
        ResetSectionRow(
            id: "dashboard_layout",
            systemImage: "rectangle.3.group.fill",
            titleKey: "settingsReset.section.dashboardLayout.title",
            titleFallback: "Dashboard layouts",
            descriptionKey: "settingsReset.section.dashboardLayout.desc",
            descriptionFallback: "Delete every saved dashboard layout preset."
        ),
        ResetSectionRow(
            id: "automations",
            systemImage: "arrow.triangle.branch",
            titleKey: "settingsReset.section.automations.title",
            titleFallback: "Automations",
            descriptionKey: "settingsReset.section.automations.desc",
            descriptionFallback: "Delete every automation, including its triggers, conditions, actions, "
                + "variables, and run history."
        ),
        ResetSectionRow(
            id: "quiet_hours",
            systemImage: "moon.zzz.fill",
            titleKey: "settingsReset.section.quietHours.title",
            titleFallback: "Quiet hours",
            descriptionKey: "settingsReset.section.quietHours.desc",
            descriptionFallback: "Delete every quiet-hours window for your account."
        )
    ]

    /// The two sections that are NOT user-resettable from this surface (web `useDeniedRows`).
    public static let deniedSections: [ResetDeniedRow] = [
        ResetDeniedRow(
            id: "tariffs",
            titleKey: "settingsReset.denied.tariffs.title",
            titleFallback: "Charge cost tariffs",
            reasonKey: "settingsReset.denied.tariffs.reason",
            reasonFallback: "Tariffs are stored per-vehicle. Reset the assignment from the Vehicle Settings "
                + "page on the vehicle detail screen."
        ),
        ResetDeniedRow(
            id: "sound_prefs",
            titleKey: "settingsReset.denied.soundPrefs.title",
            titleFallback: "Notification sound preferences",
            reasonKey: "settingsReset.denied.soundPrefs.reason",
            reasonFallback: "Notification sound preferences are stored in your browser. Clear them via "
                + "your browser’s site-data controls."
        )
    ]
}

// MARK: - Render phase (web is always rendered; native skeleton precedes the list)

/// The mutually-exclusive top-level render branches. The web section is always rendered;
/// the native `loading` skeleton shows only before the resettable-section list first
/// resolves, after which the always-usable controls (incl. the global danger zone) show.
public enum ResetPhase: Sendable, Equatable {
    case loading
    case ready
}

/// The load status of the resettable-section list, mirroring the shared `LoadableState`
/// a production source projects from the backend section registry.
public enum ResetSectionsStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Resolves the render phase from the section-list load status. A still-loading list holds
/// the skeleton; a resolved (loaded) or failed list reveals the surface — on failure the
/// canonical fallback catalog stays applied, the controls stay usable, and the failure is
/// surfaced by the status banner, never by hiding content.
public enum ResetPhaseResolver {
    public static func resolve(status: ResetSectionsStatus) -> ResetPhase {
        switch status {
        case .loading: .loading
        case .loaded, .failed: .ready
        }
    }
}

// MARK: - Freshness + status banner (the P4 states contract: error / stale / offline)

/// The freshness of the cached resettable-section list. `stale` shows a refreshing chip +
/// triggers one auto-refresh; `offline` shows an offline chip; in both cases the cached
/// list stays applied and the controls stay usable.
public enum ResetFreshness: Sendable, Equatable {
    case fresh
    case stale
    case offline
}

/// The visual tone of the section-list status banner.
public enum ResetBannerTone: Sendable, Equatable {
    case error
    case offline
    case stale
}

/// The projected status banner shown above the panels when the section list is failed /
/// offline / stale. `nil` when the list is fresh + loaded. The cached catalog stays applied
/// beneath it (cached value never hidden).
public struct ResetStatusBanner: Sendable, Equatable {
    public let tone: ResetBannerTone
    public let messageKey: String
    public let messageFallback: String
    public let showsRetry: Bool

    public init(tone: ResetBannerTone, messageKey: String, messageFallback: String, showsRetry: Bool) {
        self.tone = tone
        self.messageKey = messageKey
        self.messageFallback = messageFallback
        self.showsRetry = showsRetry
    }

    /// The localized banner message resolved through the facade.
    public func message(_ localize: ResetLocalize) -> String {
        localize(messageKey, messageFallback)
    }
}

// MARK: - Adapter (pure projection)

/// Pure projection + the web-parity derived values shared by the views and the tests.
/// No store, no bundle, no SwiftUI.
public enum ResetAdapter {
    // MARK: Status banner

    /// Projects the section-list status banner. Offline (the root cause) takes precedence,
    /// then a hard failure (retryable), then a stale refresh (retryable); a fresh, loaded
    /// list yields no banner.
    public static func statusBanner(
        status: ResetSectionsStatus,
        freshness: ResetFreshness
    ) -> ResetStatusBanner? {
        if freshness == .offline {
            return ResetStatusBanner(
                tone: .offline,
                messageKey: "settingsReset.status.offline",
                messageFallback: "Offline — showing the last known section list",
                showsRetry: false
            )
        }
        if case .failed = status {
            return ResetStatusBanner(
                tone: .error,
                messageKey: "settingsReset.status.error",
                messageFallback: "Couldn’t load the resettable sections",
                showsRetry: true
            )
        }
        if freshness == .stale {
            return ResetStatusBanner(
                tone: .stale,
                messageKey: "settingsReset.status.stale",
                messageFallback: "Refreshing the resettable sections…",
                showsRetry: true
            )
        }
        return nil
    }

    // MARK: Success-toast detail (web `successDetail` counter)

    /// The success-toast detail line (web `t('settingsReset.toasts.successDetail',
    /// { count, sections })`). Both counts are clamped to zero so a malformed receipt can
    /// never render a negative tally.
    public static func successDetail(reset: Int, sectionsCount: Int, localize: ResetLocalize) -> String {
        let format = localize(
            "settingsReset.toasts.successDetail",
            "%1$lld item(s) reset across %2$lld section(s)."
        )
        return String(format: format, max(0, reset), max(0, sectionsCount))
    }

    // MARK: Confirm templating (web `Reset {{name}}?` / `{{description}} …`)

    /// The per-section confirm title (web `t('settingsReset.confirm.sectionTitle',
    /// { name })`).
    public static func confirmSectionTitle(name: String, localize: ResetLocalize) -> String {
        String(format: localize("settingsReset.confirm.sectionTitle", "Reset %@?"), name)
    }

    /// The per-section confirm message (web `t('settingsReset.confirm.sectionMessage',
    /// { description })`).
    public static func confirmSectionMessage(description: String, localize: ResetLocalize) -> String {
        String(
            format: localize("settingsReset.confirm.sectionMessage", "%@ This action is permanent."),
            description
        )
    }

    // MARK: Typed confirmation (web `requireTypedConfirmation="RESET"`)

    /// The exact phrase the danger-zone field must read before the global reset enables
    /// (web `requireTypedConfirmation="RESET"`).
    public static let resetAllPhrase = "RESET"

    /// Whether the typed danger-zone confirmation is satisfied (web confirm-button
    /// `disabled={typed !== required}`). Surrounding whitespace is trimmed; the match is
    /// otherwise exact + case-sensitive so a casual "reset" does not arm the wipe.
    public static func canConfirmResetAll(input: String) -> Bool {
        input.trimmingCharacters(in: .whitespacesAndNewlines) == resetAllPhrase
    }

    // MARK: Disabled predicates (web `disabled={…}`)

    /// A per-section Reset button is disabled while that same section's reset is in flight
    /// (web `busy={sectionBusy && pending?.id === row.id}`).
    public static func isSectionResetDisabled(rowID: String, resettingSectionID: String?) -> Bool {
        resettingSectionID == rowID
    }

    /// The danger-zone trigger is disabled while the global reset is in flight (web
    /// `disabled={allBusy}`).
    public static func isResetAllDisabled(isResettingAll: Bool) -> Bool {
        isResettingAll
    }

    // MARK: Accessibility summaries (testable seam)

    /// The VoiceOver summary for a section row: the title plus its description, so the row
    /// is announced as one coherent element ahead of its Reset action.
    public static func sectionAccessibility(row: ResetSectionRow, localize: ResetLocalize) -> String {
        "\(row.title(localize)). \(row.description(localize))"
    }

    /// The VoiceOver summary for a deny-list row: the title plus the reason it can't be
    /// reset here.
    public static func deniedAccessibility(row: ResetDeniedRow, localize: ResetLocalize) -> String {
        "\(row.title(localize)). \(row.reason(localize))"
    }
}
