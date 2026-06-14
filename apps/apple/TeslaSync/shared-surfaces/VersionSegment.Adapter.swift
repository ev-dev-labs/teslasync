//
//  VersionSegment.Adapter.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  The testable, dependency-light core for the footer status-bar version segment — the SwiftUI parity
//  of `components/layout/status-bar/VersionSegment.tsx`. Everything here is pure (Foundation only): the
//  surface identity (the diagnostics slug + the two web poll cadences + the release-notes URL), the
//  freshness axis (``VersionSegmentConnection``), the value-typed peers of the web API responses
//  (``VersionSegmentInfo`` ← `/system/version`, ``UpdateCheckResult`` ← `/system/update-check`), the build-time
//  provenance (``VersionSegmentBuildInfo`` — the native peer of `VITE_APP_VERSION` / `VITE_GIT_SHA`), the
//  coalesced ``VersionSegmentSnapshot`` (the two queries + the changelog unseen count + the probe
//  lifecycle), the combined ``VersionSegmentInput`` (snapshot + build info), the view-ready
//  ``VersionSegmentData`` (the fully-derived segment + modal payload), the ``VersionSegmentResolved``
//  (phase + payload), the pure ``VersionSegmentProjection`` that maps one into the other, the uptime
//  formatter (web `uptimeLabel`), and the tooltip / VoiceOver builders. No store, no bundle, no rendered
//  view, so each rule is unit-tested in isolation.
//
//  Parity note (states): the web `<VersionSegment>` reads two genuinely-fetching `useQuery` hooks plus
//  `useChangelog`, falling back to the build-time `VITE_APP_VERSION` (worst case `'dev'`) so its button
//  never blanks. This surface reproduces that resolution order exactly AND renders the P4 leaf states
//  (loading / empty / error) the web folds away — reachable whenever the host supplies no baked build
//  version (`VersionSegmentBuildInfo` with `nil` fields), the same way the sibling NewVersionBanner
//  (0129) surfaces the probe lifecycle its web hook swallows. With a normal build (a baked version or
//  the `'dev'` default) a version always resolves, so the segment renders `.ready` — byte-for-byte the
//  web behaviour.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug + web cadences + release-notes URL)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11),
/// the two poll cadences carried over from the web `useQuery` options, the GitHub releases URL the
/// "Release notes" action opens (web `window.open(...)`), and the notification names the default host
/// seams post (the native peers of the web `window.dispatchEvent` / `window.open`). Kept SwiftUI-free so
/// the state-holder + the polling source can reference them without depending on the view layer.
public enum VersionSegmentSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "VersionSegment"

    /// The `/system/version` poll cadence — the native peer of the web `refetchInterval: 60_000` (60s).
    public static let versionPollInterval: TimeInterval = 60

    /// The `/system/update-check` poll cadence — the native peer of the web `refetchInterval: 3_600_000`
    /// (1 hour). The update check is far less volatile than the running version, so it polls hourly.
    public static let updatePollInterval: TimeInterval = 60 * 60

    /// The releases page the "Release notes" action opens — verbatim from the web
    /// `window.open('https://github.com/ev-dev-labs/teslasync/releases', …)`.
    public static let releaseNotesURL = URL(string: "https://github.com/ev-dev-labs/teslasync/releases")!

    /// The "open the changelog modal" broadcast — the native peer of the web custom event
    /// `teslasync:changelog:open` (`OPEN_CHANGELOG_MODAL_EVENT`). The default host seam posts this so the
    /// app's changelog modal can observe it, exactly as the web modal listens for the DOM event.
    public static let openChangelogNotification = Notification.Name("teslasync:changelog:open")

    /// The "open the release notes" broadcast — posted with the ``releaseNotesURL`` as the object so the
    /// host opens it through its platform URL opener (the native peer of the web `window.open`).
    public static let openReleaseNotesNotification = Notification.Name("teslasync:release-notes:open")

    /// The worst-case version sentinel — the native peer of the web `'dev'` fallback and the
    /// `app_version === 'unknown'` server sentinel that the projection treats as "no server truth".
    public static let devSentinel = "dev"
    public static let unknownSentinel = "unknown"
}

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle: the
/// production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias VersionSegmentResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound version feed — the orthogonal connectivity axis rendered as the freshness
/// chip in the modal. `live` hides the chip; `stale` (a poll failed but a value is cached) and `offline`
/// (no connectivity, last-known value retained) show it.
public enum VersionSegmentConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - API value types (web `/system/version` + `/system/update-check`)

/// The value-typed native peer of the web `VersionSegmentInfo` (`/system/version`) — only the fields the
/// segment renders. All are optional because the probe may resolve before every field is populated and
/// because the web guards each with a presence check before rendering its modal row.
public struct VersionSegmentInfo: Sendable, Equatable {
    /// The deployed app version (web `app_version`); the server sentinel `"unknown"` is treated as absent.
    public let appVersion: String?
    /// The Helm chart version (web `chart_version`); `"unknown"` is treated as absent.
    public let chartVersion: String?
    /// The Go runtime string (web `go_version`).
    public let goVersion: String?
    /// The server OS (web `os`).
    public let os: String?
    /// The server CPU architecture (web `arch`).
    public let arch: String?
    /// Server uptime in seconds (web `uptime_seconds`); formatted by ``VersionUptimeFormatter``.
    public let uptimeSeconds: Double?

    public init(
        appVersion: String? = nil,
        chartVersion: String? = nil,
        goVersion: String? = nil,
        os: String? = nil,
        arch: String? = nil,
        uptimeSeconds: Double? = nil
    ) {
        self.appVersion = appVersion
        self.chartVersion = chartVersion
        self.goVersion = goVersion
        self.os = os
        self.arch = arch
        self.uptimeSeconds = uptimeSeconds
    }
}

/// The value-typed native peer of the web `UpdateCheckResult` (`/system/update-check`). `latest` and
/// `message` are optional because the web guards them (`updateCheck?.latest` / `updateCheck?.message`).
public struct UpdateCheckResult: Sendable, Equatable {
    public let updateAvailable: Bool
    public let latest: String?
    public let message: String?

    public init(updateAvailable: Bool, latest: String? = nil, message: String? = nil) {
        self.updateAvailable = updateAvailable
        self.latest = latest
        self.message = message
    }
}

// MARK: - Build-time provenance (web `VITE_APP_VERSION` / `VITE_GIT_SHA`)

/// The build-time version + short SHA — the native peer of the web module constants
/// `BUILD_VERSION = import.meta.env.VITE_APP_VERSION || 'dev'` and
/// `BUILD_SHA = import.meta.env.VITE_GIT_SHA || 'dev'`. Both are optional so the leaf states stay
/// reachable for a host that bakes nothing; the ``dev`` default mirrors the web worst-case so a normal
/// build always resolves a version (and the segment always renders `.ready`).
public struct VersionSegmentBuildInfo: Sendable, Equatable {
    public let buildVersion: String?
    public let buildSHA: String?

    public init(buildVersion: String?, buildSHA: String?) {
        self.buildVersion = buildVersion
        self.buildSHA = buildSHA
    }

    /// The web worst-case constant pair (`'dev'` / `'dev'`).
    public static let dev = VersionSegmentBuildInfo(
        buildVersion: VersionSegmentSurface.devSentinel,
        buildSHA: VersionSegmentSurface.devSentinel
    )
}

// MARK: - Coalesced snapshot (the two web queries + changelog + probe lifecycle)

/// One coalesced snapshot of the version feed — the native peer of the web component's combined inputs:
/// the `/system/version` query (``versionInfo``), the `/system/update-check` query (``updateCheck``), the
/// `useChangelog` unseen count (``changelogUnseenCount``), plus the probe lifecycle the web `useQuery`
/// keeps implicit (`isLoading` while the first version probe is in flight with nothing cached,
/// `errorMessage` when it failed with nothing cached, and the connectivity axis).
public struct VersionSegmentSnapshot: Sendable, Equatable {
    public let versionInfo: VersionSegmentInfo?
    public let updateCheck: UpdateCheckResult?
    /// The number of changelog entries newer than the user's last-seen version (web `newEntries.length`);
    /// `hasUnseen` is derived as `> 0`.
    public let changelogUnseenCount: Int
    /// `true` while the first `/system/version` probe is in flight with nothing cached yet.
    public let isLoading: Bool
    /// A failure reason when the first version probe failed with nothing cached; `nil` otherwise.
    public let errorMessage: String?
    public let connection: VersionSegmentConnection

    public init(
        versionInfo: VersionSegmentInfo? = nil,
        updateCheck: UpdateCheckResult? = nil,
        changelogUnseenCount: Int = 0,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: VersionSegmentConnection = .live
    ) {
        self.versionInfo = versionInfo
        self.updateCheck = updateCheck
        self.changelogUnseenCount = changelogUnseenCount
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Combined input (snapshot + build-time provenance)

/// The projector's input — the coalesced snapshot combined with the build-time provenance (the web
/// module constants). Kept distinct from the snapshot because the web models them separately too: the
/// hooks own the server data, the bundle owns the build constants. A value type so the view, the
/// state-holder, and the pure projection agree on one shape.
public struct VersionSegmentInput: Sendable, Equatable {
    public let snapshot: VersionSegmentSnapshot
    public let buildInfo: VersionSegmentBuildInfo

    public init(snapshot: VersionSegmentSnapshot, buildInfo: VersionSegmentBuildInfo = .dev) {
        self.snapshot = snapshot
        self.buildInfo = buildInfo
    }
}

// MARK: - One modal provenance row (web `<dl>` dt/dd pair)

/// One derived row of the "About this build" provenance list — a web `<dt>`/`<dd>` pair reduced to its
/// i18n key + already-formatted value. Pre-derived in the pure projection (with the web presence guards
/// applied) so the modal view is a pure function of the resolved data and snapshot tests assert the rows
/// directly. ``mono`` mirrors the web `font-mono` cells (version / commit / chart / go / platform); the
/// uptime row renders in the body face.
public struct VersionProvenanceRow: Sendable, Equatable, Identifiable {
    /// Stable identity for `ForEach` (the i18n key suffix, e.g. `"appVersion"`).
    public let id: String
    /// The label i18n key (e.g. `"statusBar.version.appVersion"`).
    public let labelKey: String
    /// The web English fallback for the label.
    public let labelFallback: String
    /// The already-formatted value (rendered verbatim).
    public let value: String
    /// Whether the value renders monospaced (web `font-mono`).
    public let mono: Bool

    public init(id: String, labelKey: String, labelFallback: String, value: String, mono: Bool) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.mono = mono
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The fully-derived payload for the `.ready` phase — the entire segment + modal, pre-computed so both
/// views are pure functions of this value and snapshot tests assert them directly. Mirrors every derived
/// value the web component computes: the resolved `appVersion` / `sha`, the dot rules, the tooltip parts,
/// the modal provenance rows, and the update banner.
public struct VersionSegmentData: Sendable, Equatable {
    /// The resolved app version (web `appVersion`): server truth, else build version, else `dev`.
    public let appVersion: String
    /// The resolved short SHA (web `sha = BUILD_SHA`).
    public let sha: String
    /// Whether the SHA is meaningful (web `sha && sha !== 'dev'`) — gates the `· {sha}` label + row.
    public let hasSHA: Bool
    /// Whether an update is available (web `!!updateCheck?.update_available`).
    public let updateAvailable: Bool
    /// The latest available version (web `updateCheck?.latest`), for the update banner.
    public let latestVersion: String?
    /// The update message (web `updateCheck?.message`).
    public let updateMessage: String?
    /// The formatted server uptime (web `uptime`); `nil` hides the tooltip part + the modal row.
    public let uptimeLabel: String?
    /// Whether the user has unseen changelog entries (web `hasUnseen`).
    public let hasUnseenChangelog: Bool
    /// The count of unseen changelog entries (web `newEntries.length`), for the tooltip hint.
    public let unseenChangelogCount: Int
    /// The derived modal provenance rows (web `<dl>` rows, presence-guarded).
    public let provenanceRows: [VersionProvenanceRow]

    public init(
        appVersion: String,
        sha: String,
        hasSHA: Bool,
        updateAvailable: Bool,
        latestVersion: String?,
        updateMessage: String?,
        uptimeLabel: String?,
        hasUnseenChangelog: Bool,
        unseenChangelogCount: Int,
        provenanceRows: [VersionProvenanceRow]
    ) {
        self.appVersion = appVersion
        self.sha = sha
        self.hasSHA = hasSHA
        self.updateAvailable = updateAvailable
        self.latestVersion = latestVersion
        self.updateMessage = updateMessage
        self.uptimeLabel = uptimeLabel
        self.hasUnseenChangelog = hasUnseenChangelog
        self.unseenChangelogCount = unseenChangelogCount
        self.provenanceRows = provenanceRows
    }

    /// The dot shown on the segment — the web rule: amber when an update is available, else cyan when
    /// there are unseen changelog entries, else none. Modeled as an enum so the view holds no branch.
    public enum Dot: Sendable, Equatable {
        case update
        case unseenChangelog
        case none
    }

    public var dot: Dot {
        if updateAvailable { return .update }
        if hasUnseenChangelog { return .unseenChangelog }
        return .none
    }
}

/// The resolved, view-ready state — `phase` selects the render; for the ready phase the derived `data`
/// payload is pre-computed so both the segment and the modal are pure functions of this value.
public struct VersionSegmentResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// The first version probe is in flight with no version resolvable yet (no server, no build).
        case loading
        /// Resolved, but no version is resolvable at all — the friendly "never a blank box" empty state.
        case empty
        /// The first version probe failed with nothing cached and no build fallback.
        case error(String)
        /// A version resolved — the web segment + modal render.
        case ready
    }

    public let phase: Phase
    public let data: VersionSegmentData?

    public init(phase: Phase, data: VersionSegmentData?) {
        self.phase = phase
        self.data = data
    }
}

// MARK: - Uptime formatter (web `uptimeLabel`)

/// The byte-for-byte native port of the web `uptimeLabel(seconds)` helper: returns `nil` for a nil /
/// non-finite / non-positive input; otherwise `"{d}d {h}h"`, `"{h}h {m}m"`, or `"{m}m"` using the same
/// day/hour/minute flooring (86_400 / 3600 / 60). Pure — unit tested across each branch + the guards.
public enum VersionUptimeFormatter {
    public static func label(_ seconds: Double?) -> String? {
        guard let seconds, seconds.isFinite, seconds > 0 else { return nil }
        let total = Int(seconds)
        let days = total / 86400
        let hours = (total % 86400) / 3600
        let minutes = (total % 3600) / 60
        if days > 0 { return "\(days)d \(hours)h" }
        if hours > 0 { return "\(hours)h \(minutes)m" }
        return "\(minutes)m"
    }
}
