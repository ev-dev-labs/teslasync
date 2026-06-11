//
//  NewVersionBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0129 · NewVersionBanner (Apple)
//
//  The testable, dependency-light core for the "new version available" banner — the SwiftUI parity
//  of `components/feedback/NewVersionBanner.tsx`. Everything here is pure (Foundation only): the
//  surface identity (the diagnostics slug + the poll cadence), the freshness axis
//  (``NewVersionConnection``), the version-watcher snapshot (``NewVersionWatcherSnapshot`` — the
//  native peer of the web `useVersionWatcher` return value plus the probe lifecycle), the combined
//  ``NewVersionBannerInput`` (the snapshot + the surface-local dismissal), the view-ready
//  ``NewVersionBannerResolved`` (phase + payload), and the pure ``NewVersionBannerProjection`` that
//  maps one into the other. No store, no bundle, no rendered view, so each rule is unit-tested in
//  isolation.
//
//  Parity note (states): the web `<NewVersionBanner>` reads `useVersionWatcher`, which polls
//  `/system/version` for the deployed `app_version`. The hook genuinely fetches — so this surface's
//  loading / error / stale / offline branches are REAL probe states, not invented chrome. The web
//  component itself folds those into `return null` (the hook swallows transient errors and the banner
//  only renders when a NEW version is detected); the native surface instead renders each as a friendly
//  state per the P4 leaf contract (never a blank box), the same way the sibling AiLimitBanner (0025)
//  does for a banner whose web peer returns null. The web-source-specific branches are reproduced
//  exactly: the boot baseline, the `latest != boot` availability rule, and the per-version dismissal
//  (web sessionStorage) with its reset-on-new-version behaviour.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug + web poll cadence)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11)
/// and the poll cadence carried over byte-for-byte from the web `useVersionWatcher`. Kept SwiftUI-free
/// so the state-holder + the polling source can reference them without depending on the view layer.
public enum NewVersionBannerSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "NewVersionBanner"

    /// The version-probe cadence — the native peer of the web `POLL_INTERVAL_MS = 5 * 60 * 1000`
    /// (5 minutes). The polling source re-probes `/system/version` at this interval after the boot
    /// baseline is captured.
    public static let pollInterval: TimeInterval = 5 * 60
}

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias NewVersionBannerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound version feed — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` (a poll failed but a baseline is cached) and
/// `offline` (no connectivity, last-known version retained) show it.
public enum NewVersionConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Watcher snapshot (web `useVersionWatcher` return + probe lifecycle)

/// One coalesced snapshot of the version watcher — the native peer of the web `VersionWatcherState`
/// (`bootVersion` / `latestVersion`) plus the probe lifecycle the web hook keeps implicit
/// (`isLoading` while the boot probe is in flight, `errorMessage` when the boot probe fails with
/// nothing cached, and the connectivity axis). `newVersionAvailable` is derived exactly as the web
/// hook derives it: a captured boot baseline, a resolved latest version, and the two differing.
public struct NewVersionWatcherSnapshot: Sendable, Equatable {
    /// The `app_version` reported on the first successful probe (web `bootVersion`); `nil` until the
    /// boot probe resolves.
    public let bootVersion: String?
    /// The most recent `app_version` reported by a poll (web `latestVersion`); `nil` until the first
    /// probe completes.
    public let latestVersion: String?
    /// `true` while the boot probe is in flight with no baseline yet (web: `bootVersion == null`).
    public let isLoading: Bool
    /// A failure reason when the boot probe failed with nothing cached; `nil` otherwise. Post-baseline
    /// poll failures do NOT set this (web swallows them) — they move the connection to stale/offline.
    public let errorMessage: String?
    /// The freshness of the feed (P4 connectivity axis).
    public let connection: NewVersionConnection

    public init(
        bootVersion: String? = nil,
        latestVersion: String? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: NewVersionConnection = .live
    ) {
        self.bootVersion = bootVersion
        self.latestVersion = latestVersion
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }

    /// `true` iff a boot baseline and a latest version are both known and they differ — the byte-for-byte
    /// native port of the web `!!(bootVersion && latestVersion && latestVersion !== bootVersion)`.
    public var newVersionAvailable: Bool {
        guard let bootVersion, let latestVersion else { return false }
        return latestVersion != bootVersion
    }
}

// MARK: - Combined input (web hook output + the component's local dismissal)

/// The projector's input — the watcher snapshot (the web hook output) combined with the surface-local
/// `dismissedVersion` (the web component's `useState`, seeded from sessionStorage). Kept distinct from
/// the snapshot because the web models them separately too: the hook owns the version data, the
/// component owns the per-version dismissal. A value type so the view, the state-holder, and the pure
/// projection agree on one shape.
public struct NewVersionBannerInput: Sendable, Equatable {
    public let snapshot: NewVersionWatcherSnapshot
    /// The version the user dismissed (web `sessionStorage[SESSION_DISMISS_KEY]`); suppresses the
    /// banner only while it equals the current `latestVersion`.
    public let dismissedVersion: String?

    public init(snapshot: NewVersionWatcherSnapshot, dismissedVersion: String? = nil) {
        self.snapshot = snapshot
        self.dismissedVersion = dismissedVersion
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The data payload for the `.available` phase — the fully-derived banner. A pure value so the view is
/// a function of it and snapshot tests assert it directly. `latestVersion` is the deploy the user would
/// reload onto; `bootVersion` is the build the tab booted on, carried for the VoiceOver detail.
public struct NewVersionBannerData: Sendable, Equatable {
    public let latestVersion: String
    public let bootVersion: String

    public init(latestVersion: String, bootVersion: String) {
        self.latestVersion = latestVersion
        self.bootVersion = bootVersion
    }
}

/// The resolved, view-ready state — `phase` selects the body; for the available phase the derived
/// `data` payload is pre-computed so the view is a pure function of this value.
public struct NewVersionBannerResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// The boot probe is in flight with no baseline yet (web `bootVersion == null`).
        case loading
        /// Up to date, still baselining, or dismissed for the current version — the friendly native
        /// parity of the web banner returning `null` (never a blank box).
        case empty
        /// The boot probe failed with nothing cached (web swallows this into `null`; surfaced here).
        case error(String)
        /// A new version is available and not dismissed — the web banner render.
        case available
    }

    public let phase: Phase
    public let data: NewVersionBannerData?

    public init(phase: Phase, data: NewVersionBannerData?) {
        self.phase = phase
        self.data = data
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// The pure projection from the combined input to the resolved view-state — the native port of the
/// web banner's render logic: the boot-probe lifecycle, the `newVersionAvailable` rule, and the
/// per-version dismissal guard (`latestVersion && dismissedVersion === latestVersion`). Unit tested
/// across loading / empty / error / available and every dismissal combination.
public enum NewVersionBannerProjection {
    public static func resolve(_ input: NewVersionBannerInput) -> NewVersionBannerResolved {
        let snapshot = input.snapshot
        // P4 contract: a boot-probe failure with nothing cached surfaces at the leaf as `error`.
        if let message = snapshot.errorMessage, !message.isEmpty {
            return NewVersionBannerResolved(phase: .error(message), data: nil)
        }
        // The boot probe is still in flight (web `bootVersion == null`).
        if snapshot.isLoading {
            return NewVersionBannerResolved(phase: .loading, data: nil)
        }
        // No new version (web `if (!newVersionAvailable) return null`) → friendly empty, never a blank box.
        guard
            snapshot.newVersionAvailable,
            let boot = snapshot.bootVersion,
            let latest = snapshot.latestVersion
        else {
            return NewVersionBannerResolved(phase: .empty, data: nil)
        }
        // Dismissed for exactly this version (web `dismissedVersion === latestVersion`) → empty.
        if input.dismissedVersion == latest {
            return NewVersionBannerResolved(phase: .empty, data: nil)
        }
        let data = NewVersionBannerData(latestVersion: latest, bootVersion: boot)
        return NewVersionBannerResolved(phase: .available, data: data)
    }
}

// MARK: - Dismissal reset (web `useEffect` that clears a stale dismissal)

/// The pure rule behind the web effect that resets the local dismissal when the latest version moves
/// past it: `if (dismissedVersion && dismissedVersion !== latestVersion) setDismissedVersion(null)`.
/// Returns the dismissal that should remain after observing `latestVersion` — `nil` once the deploy has
/// advanced beyond the dismissed build, so the banner re-surfaces for the newer version.
public enum NewVersionDismissalReset {
    public static func resolve(dismissedVersion: String?, latestVersion: String?) -> String? {
        guard let dismissedVersion, let latestVersion else { return dismissedVersion }
        return dismissedVersion == latestVersion ? dismissedVersion : nil
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the banner's combined VoiceOver label from already-localised parts, so the spoken content is
/// asserted without rendering the view. Announces the availability message and, when known, the target
/// version, as one sentence — the accessible parity of the web `role="status" aria-live="polite"` row.
public enum NewVersionBannerAccessibility {
    public static func bannerLabel(message: String, versionDetail: String?) -> String {
        guard let versionDetail, !versionDetail.isEmpty else { return message }
        let endsWithTerminal = message.last.map { ".!?".contains($0) } ?? false
        return message + (endsWithTerminal ? " " : ". ") + versionDetail
    }
}
