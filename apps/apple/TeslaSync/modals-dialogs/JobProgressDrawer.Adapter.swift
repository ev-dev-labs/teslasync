//
//  JobProgressDrawer.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0005 · JobProgressDrawer (Apple)
//
//  The testable, dependency-free projection core for the export job-progress drawer — the
//  faithful port of components/feedback/JobProgressDrawer.tsx and the `useExports`
//  (`ExportJobSummary`, `exportDownloadUrl`) wire types it binds to. Everything here is
//  pure Foundation so the enums, the display-ready row, the two-bucket split (active vs
//  recent), the drawer-state machine (open / minimized / dismissed → resolved visibility),
//  the body phase, the relative-time projection, and the byte formatter are all unit-tested
//  without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web widget is a floating, minimizable drawer with three persisted states. It
//      auto-promotes dismissed → minimized when a new active job appears and ambient-hides
//      when there are zero jobs and nothing is loading. `resolveVisibility` reproduces that
//      machine; `pinned` suppresses the ambient hide so an intentionally-presented modal
//      still renders loading / empty / error chrome (engineering guideline #6 — never hide
//      a section on null).
//    • `activeJobs` / `recentJobs` mirror the web `filter(isActive)` /
//      `filter(!isActive).slice(0, maxRecent)`. `bodyPhase` widens the web loading/sections
//      split with an error envelope so a first-load failure with no cached rows is never a
//      blank box.
//    • `ExportDrawerBytesFormatter` / `ExportDrawerRelative` are faithful ports of
//      lib/numberFormat.ts `formatBytes` and lib/dateFormat.ts `formatRelative`.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free
/// core so the projection's unit tests can reach it.
public enum JobProgressDrawerSurface {
    public static let slug = "JobProgressDrawer"
}

// MARK: - Status (web `ExportJobSummary['status']`)

/// The lifecycle state of an export job (web `'queued' | 'processing' | 'ready' | 'failed' |
/// 'expired'`). The label resolves through the injected P1/S10 localizer so the view holds no
/// hardcoded English.
public enum ExportDrawerStatus: String, Sendable, Equatable, Hashable, CaseIterable {
    case queued
    case processing
    case ready
    case failed
    case expired

    /// The per-status i18n key (`export.status.<raw>`).
    public var labelKey: String {
        "export.status.\(rawValue)"
    }

    /// The web fallback label (web `prettyStatus`).
    public var labelFallback: String {
        switch self {
        case .queued: "Queued"
        case .processing: "Processing"
        case .ready: "Ready"
        case .failed: "Failed"
        case .expired: "Expired"
        }
    }

    /// Web `isActive(job)`: a job is active while queued or processing.
    public var isActive: Bool {
        self == .queued || self == .processing
    }
}

// MARK: - Kind (web `ExportJobSummary['type']` + `prettyType`)

/// The dataset an export job carries (web `job.type`). Known tokens resolve to a localized
/// label; an unknown token is preserved verbatim (web `prettyType` default returns the raw
/// `type`).
public enum ExportDrawerKind: Sendable, Equatable, Hashable {
    case account
    case drives
    case charging
    case analytics
    case backup
    case importDrives
    case importCharging
    case other(String)

    /// Maps a raw API token to a kind, preserving unknown tokens (web switch default).
    public init(raw: String) {
        switch raw {
        case "account": self = .account
        case "drives": self = .drives
        case "charging": self = .charging
        case "analytics": self = .analytics
        case "backup": self = .backup
        case "import_drives": self = .importDrives
        case "import_charging": self = .importCharging
        default: self = .other(raw)
        }
    }

    /// The per-kind i18n key, or `nil` for an unknown token (rendered verbatim).
    public var labelKey: String? {
        switch self {
        case .account: "export.types.account"
        case .drives: "export.types.drives"
        case .charging: "export.types.charging"
        case .analytics: "export.types.analytics"
        case .backup: "export.types.backup"
        case .importDrives: "export.types.importDrives"
        case .importCharging: "export.types.importCharging"
        case .other: nil
        }
    }

    /// The web English fallback (web `prettyType`); an unknown token returns itself.
    public var labelFallback: String {
        switch self {
        case .account: "Account export"
        case .drives: "Drives"
        case .charging: "Charging"
        case .analytics: "Analytics"
        case .backup: "Backup"
        case .importDrives: "Import drives"
        case .importCharging: "Import charging"
        case let .other(raw): raw
        }
    }

    /// The display label, resolved through the injected localizer for known kinds (web
    /// `prettyType`); unknown tokens are returned verbatim.
    public func label(localize: (String, String) -> String) -> String {
        if let labelKey {
            return localize(labelKey, labelFallback)
        }
        return labelFallback
    }
}

// MARK: - Display-ready row (web `ExportJobSummary`)

/// One export job — the native parity of a web `ExportJobSummary`. Times are resolved `Date`
/// (the web carries ISO-8601 strings, always UTC); nullable columns stay optional so the
/// view picks the em-dash / empty fallbacks explicitly.
public struct ExportDrawerJob: Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: ExportDrawerKind
    public let format: String
    public let status: ExportDrawerStatus
    public let fileSize: Int?
    public let errorMessage: String?
    public let createdAt: Date
    public let completedAt: Date?

    public init(
        id: String,
        kind: ExportDrawerKind,
        format: String,
        status: ExportDrawerStatus,
        fileSize: Int? = nil,
        errorMessage: String? = nil,
        createdAt: Date,
        completedAt: Date? = nil
    ) {
        self.id = id
        self.kind = kind
        self.format = format
        self.status = status
        self.fileSize = fileSize
        self.errorMessage = errorMessage
        self.createdAt = createdAt
        self.completedAt = completedAt
    }

    /// Web `isActive(job)`.
    public var isActive: Bool {
        status.isActive
    }

    /// The bucket this job belongs to (web `bucketFor`).
    public var bucket: ExportDrawerBucket {
        isActive ? .active : .recent
    }

    /// The relative-time anchor the recent row renders (web `completed_at ?? created_at`).
    public var settledAt: Date {
        completedAt ?? createdAt
    }

    /// The artifact download path (web `exportDownloadUrl(id)`). The `request()` client base
    /// is applied at the networking boundary; this is the canonical relative path.
    public var downloadPath: String {
        "/api/v1/export/jobs/\(id)/download"
    }

    /// The web "format" chip (`{job.format}` rendered uppercase).
    public var formatLabel: String {
        format.uppercased()
    }

    /// The web "Type" label, resolved through the injected localizer.
    public func typeLabel(localize: (String, String) -> String) -> String {
        kind.label(localize: localize)
    }
}

// MARK: - Buckets / presentation / phases

/// Which list a job is shown in (web `JobBucket`).
public enum ExportDrawerBucket: Sendable, Equatable {
    case active
    case recent
}

/// The persisted drawer state (web `DrawerState`).
public enum JobDrawerPresentation: String, Sendable, Equatable {
    case open
    case minimized
    case dismissed
}

/// What the surface actually renders after the state machine resolves (the web early-returns
/// `null` for the hidden case).
public enum JobDrawerVisibility: Sendable, Equatable {
    case hidden
    case minimized
    case open
}

/// What the open panel body renders. The web splits loading vs the two sections; the empty
/// and error envelopes are added so an intentionally-presented modal is never a blank box.
public enum JobDrawerBodyPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case populated
}

// MARK: - Load status / freshness

/// The bound source's load status for the jobs query (web `isLoading` / resolved / failure).
public enum ExportDrawerLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so a
/// cached list is clearly labeled while reconnecting / offline.
public enum ExportDrawerConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Relative time (port of lib/dateFormat.ts `formatRelative`)

/// The structured relative-time bucket the web `formatRelative` collapses an instant into.
/// Kept as data (not a localized string) so the projection is pure + testable; the date
/// facade resolves it to copy through P1/S10.
public enum ExportDrawerRelative: Sendable, Equatable {
    case empty
    case justNow
    case minutes(Int)
    case hours(Int)
    case days(Int)
    case absolute(Date)

    /// The faithful port of web `formatRelative(iso)` against an injected `now` (so tests are
    /// deterministic): < 60s → just now, < 60m → m, < 24h → h, < 7d → d, else absolute date.
    public static func from(_ date: Date?, now: Date) -> ExportDrawerRelative {
        guard let date else { return .empty }
        let diff = now.timeIntervalSince(date)
        if diff < 60 { return .justNow }
        let seconds = Int(diff)
        let minutes = seconds / 60
        if minutes < 60 { return .minutes(minutes) }
        let hours = minutes / 60
        if hours < 24 { return .hours(hours) }
        let days = hours / 24
        if days < 7 { return .days(days) }
        return .absolute(date)
    }
}

// MARK: - Byte formatter (port of lib/numberFormat.ts `formatBytes`)

/// The faithful port of web `formatBytes(bytes, { zeroAsEmpty, gbDecimals })` used by the
/// recent-row size fragment (`zeroAsEmpty: true, gbDecimals: 2`). Unit symbols (B/KB/MB/GB)
/// are universal and rendered verbatim, exactly as the web util does.
public enum ExportDrawerBytesFormatter {
    public static func string(
        _ bytes: Int?,
        zeroAsEmpty: Bool = true,
        gbDecimals: Int = 2,
        empty: String = "—"
    ) -> String {
        guard let bytes, bytes >= 0 else { return empty }
        if zeroAsEmpty, bytes == 0 { return empty }
        if bytes < 1024 { return "\(bytes) B" }
        let kibi = 1024.0
        let mebi = kibi * 1024
        let gibi = mebi * 1024
        let value = Double(bytes)
        if value < mebi { return "\(decimal(value / kibi, places: 1)) KB" }
        if value < gibi { return "\(decimal(value / mebi, places: 1)) MB" }
        return "\(decimal(value / gibi, places: gbDecimals)) GB"
    }

    /// Fixed-decimal rendering matching JS `Number.toFixed(places)`.
    private static func decimal(_ value: Double, places: Int) -> String {
        String(format: "%.\(max(0, places))f", value)
    }
}

// MARK: - Projection core (pure)

/// The dependency-free resolution from the bound source + persisted drawer state to the
/// rendered buckets, visibility, and body phase.
public enum JobProgressDrawerProjection {
    /// Web `activeJobs = allJobs.filter(isActive)`.
    public static func activeJobs(_ jobs: [ExportDrawerJob]) -> [ExportDrawerJob] {
        jobs.filter(\.isActive)
    }

    /// Web `recentJobs = allJobs.filter(!isActive).slice(0, maxRecent)`.
    public static func recentJobs(_ jobs: [ExportDrawerJob], maxRecent: Int) -> [ExportDrawerJob] {
        Array(jobs.lazy.filter { !$0.isActive }.prefix(max(0, maxRecent)))
    }

    /// Web `useEffect` auto-promote: a dismissed drawer is promoted to minimized when an
    /// active job appears so the user notices it.
    public static func shouldPromoteFromDismissed(
        stored: JobDrawerPresentation,
        hasActive: Bool
    ) -> Bool {
        stored == .dismissed && hasActive
    }

    /// The web drawer-state machine resolved to what the surface renders.
    ///
    /// - `pinned` models an intentionally-presented modal: it suppresses the ambient
    ///   auto-hide (web `allJobs.length === 0 && !isLoading → null`) so loading / empty /
    ///   error chrome still renders rather than vanishing (engineering guideline #6). The
    ///   ambient floating widget (`pinned == false`) stays 100% web-faithful.
    public static func resolveVisibility(
        stored: JobDrawerPresentation,
        hasActive: Bool,
        hasAny: Bool,
        isLoading: Bool,
        pinned: Bool
    ) -> JobDrawerVisibility {
        let effective: JobDrawerPresentation =
            shouldPromoteFromDismissed(stored: stored, hasActive: hasActive) ? .minimized : stored
        // Web: `state === 'dismissed' && activeJobs.length === 0 → null`.
        if effective == .dismissed { return .hidden }
        // Web: `allJobs.length === 0 && !isLoading → null` (ambient only).
        if !pinned, !hasAny, !isLoading { return .hidden }
        switch effective {
        case .minimized: return .minimized
        case .open: return .open
        case .dismissed: return .hidden
        }
    }

    /// The open panel body phase. The web shows the loading line until the first jobs arrive,
    /// then the two sections; empty + error are added so the modal is never blank.
    public static func bodyPhase(
        status: ExportDrawerLoadStatus,
        hasAny: Bool
    ) -> JobDrawerBodyPhase {
        switch status {
        case .loading:
            hasAny ? .populated : .loading
        case .loaded:
            hasAny ? .populated : .empty
        case let .failed(message):
            hasAny ? .populated : .error(message)
        }
    }

    /// The failure message kept on screen while cached rows survive a failed reload (the
    /// inline error shown above the sections), else `nil`.
    public static func inlineFailure(
        status: ExportDrawerLoadStatus,
        hasAny: Bool
    ) -> String? {
        guard hasAny, case let .failed(message) = status else { return nil }
        return message
    }
}
