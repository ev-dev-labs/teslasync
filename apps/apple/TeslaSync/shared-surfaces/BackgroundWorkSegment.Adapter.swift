//
//  BackgroundWorkSegment.Adapter.swift
//  TeslaSync — P4 shared surface · 0177 · BackgroundWorkSegment (Apple)
//
//  The testable, dependency-light core for the footer status-bar background-work segment — the SwiftUI
//  parity of `components/layout/status-bar/BackgroundWorkSegment.tsx`. Everything here is pure
//  (Foundation only): the surface identity (the diagnostics slug + the web `useExportJobs` poll cadence),
//  the freshness axis (``BackgroundWorkConnection``), the value-typed peer of the web `BackgroundJob`
//  (kind / label / description / startedAt, from `useBackgroundJobs`), the coalesced
//  ``BackgroundWorkSnapshot`` (the aggregated job list + the probe lifecycle the web `useQuery` keeps
//  implicit), the view-ready ``BackgroundWorkData`` (the sorted jobs + count), the
//  ``BackgroundWorkResolved`` (phase + payload), the pure ``BackgroundWorkProjection`` that maps one into
//  the other (the web `hasJobs`/`count` derivation + the oldest-first sort), and the summary + tooltip +
//  VoiceOver builders (the web `summary`, `<Tooltip content>` row, and `aria-label`). No store, no
//  bundle, no rendered view, so each rule is unit-tested in isolation.
//
//  Parity note (states): the web `<BackgroundWorkSegment>` returns `null` when `!hasJobs`, so it is
//  invisible while the app is quiet and only appears once work is in flight. This surface reproduces that
//  "active" render exactly (the spinner + summary button opening the running-jobs popover) AND renders the
//  P4 leaf states (loading / empty / error) the web folds away: the `empty` phase is the friendly
//  "never a blank box" peer of the web `null` (the host may instead hide the surface via
//  ``BackgroundWorkSegmentModel/hasJobs``, the native peer of the web `hasJobs` gate), `loading` is the
//  first `/export/jobs` probe in flight, and `error` is that probe failing with nothing cached (the web
//  hook swallows it). The same disposition the sibling VersionSegment (0181) uses for the leaf lifecycle
//  its web hook hides.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug + web poll cadence)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11) and
/// the poll cadence carried over from the web `useExportJobs({ pollWhileActive: true })` refetch. Kept
/// SwiftUI-free so the state-holder + the polling source can reference it without depending on the view
/// layer.
public enum BackgroundWorkSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "BackgroundWorkSegment"

    /// The `/export/jobs` poll cadence — the native peer of the web `useExportJobs` "poll while active"
    /// refetch (5s) that keeps in-flight export rows fresh while the segment is visible.
    public static let pollInterval: TimeInterval = 5
}

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle: the
/// production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias BackgroundWorkResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound job feed — the orthogonal connectivity axis rendered as the freshness chip
/// in the popover. `live` hides the chip; `stale` (a poll failed but the last job list is cached) and
/// `offline` (no connectivity, last-known list retained) show it.
public enum BackgroundWorkConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Background job (web `BackgroundJob` from `useBackgroundJobs`)

/// What kind of background work a row represents — the native peer of the web `BackgroundJobKind`
/// (`'export' | 'mutation' | 'custom'`). Drives the row glyph exactly as the web `KIND_ICON` map does
/// (FileDown / Save / Sparkles → the SF Symbol peers below).
public enum BackgroundJobKind: String, Sendable, Equatable, CaseIterable {
    case export
    case mutation
    case custom

    /// The SF Symbol peer of the web `KIND_ICON` glyph: `export` → FileDown (`arrow.down.doc`),
    /// `mutation` → Save (`square.and.arrow.down`), `custom` → Sparkles (`sparkles`).
    public var systemImage: String {
        switch self {
        case .export: "arrow.down.doc"
        case .mutation: "square.and.arrow.down"
        case .custom: "sparkles"
        }
    }

    /// The i18n key for the kind's VoiceOver name (the spoken category for the otherwise-decorative glyph).
    public var accessibilityKey: String {
        "statusBar.background.kind.\(rawValue)"
    }

    /// The web English fallback for the kind's VoiceOver name.
    public var accessibilityFallback: String {
        switch self {
        case .export: "Export"
        case .mutation: "Saving"
        case .custom: "Task"
        }
    }
}

/// One in-flight background job — the value-typed native peer of the web `BackgroundJob`
/// (`useBackgroundJobs`). `label` + `description` are already-localised display data supplied by the
/// source (the web hook's "already i18n'd by the caller" contract), rendered verbatim by the view;
/// `startedAt` is the ISO timestamp used as the oldest-first sort key (web `a.startedAt.localeCompare`).
public struct BackgroundJob: Sendable, Equatable, Identifiable {
    /// Stable id used for de-duplication + `ForEach` (web `BackgroundJob.id`).
    public let id: String
    /// What kind of work this is — drives the row glyph (web `BackgroundJob.kind`).
    public let kind: BackgroundJobKind
    /// The human-readable title shown in the popover (web `BackgroundJob.label`, already localised).
    public let label: String
    /// The optional secondary line shown beneath the label (web `BackgroundJob.description`).
    public let description: String?
    /// ISO timestamp when the job was registered; the oldest-first sort key (web `BackgroundJob.startedAt`).
    public let startedAt: String

    public init(id: String, kind: BackgroundJobKind, label: String, description: String? = nil, startedAt: String) {
        self.id = id
        self.kind = kind
        self.label = label
        self.description = description
        self.startedAt = startedAt
    }
}

// MARK: - Coalesced snapshot (web `useBackgroundJobs` result + probe lifecycle)

/// One coalesced snapshot of the background-work feed — the native peer of the web `useBackgroundJobs`
/// composition (export jobs + mutation activity + custom registrations), plus the probe lifecycle the web
/// `useExportJobs` query keeps implicit (`isLoading` while the first `/export/jobs` probe is in flight with
/// nothing cached, `errorMessage` when it failed with nothing cached, and the connectivity axis).
public struct BackgroundWorkSnapshot: Sendable, Equatable {
    /// The aggregated in-flight jobs (unsorted; the projection applies the oldest-first sort).
    public let jobs: [BackgroundJob]
    /// `true` while the first `/export/jobs` probe is in flight with nothing cached yet.
    public let isLoading: Bool
    /// A failure reason when the first probe failed with nothing cached; `nil` otherwise.
    public let errorMessage: String?
    public let connection: BackgroundWorkConnection

    public init(
        jobs: [BackgroundJob] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: BackgroundWorkConnection = .live
    ) {
        self.jobs = jobs
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branch + P4 leaf contract)

/// The fully-derived payload for the `.active` phase — the sorted job list + the count, pre-computed so
/// the segment + popover are pure functions of this value and snapshot tests assert them directly. Mirrors
/// the web `jobs` (sorted oldest-first) + `count`.
public struct BackgroundWorkData: Sendable, Equatable {
    /// The in-flight jobs, sorted oldest-first (web `jobs` after the `localeCompare` sort).
    public let jobs: [BackgroundJob]
    /// How many jobs are running (web `count`).
    public let count: Int

    public init(jobs: [BackgroundJob], count: Int) {
        self.jobs = jobs
        self.count = count
    }
}

/// The resolved, view-ready state — `phase` selects the render; for the active phase the derived `data`
/// payload is pre-computed so both the segment and the popover are pure functions of this value.
public struct BackgroundWorkResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// The first `/export/jobs` probe is in flight with nothing resolved yet (web `useQuery` loading).
        case loading
        /// Resolved with no jobs running — the friendly "never a blank box" peer of the web `null` render.
        case empty
        /// The first probe failed with nothing cached — the leaf the web hook swallows.
        case error(String)
        /// One or more jobs are running — the web segment button + popover render.
        case active
    }

    public let phase: Phase
    public let data: BackgroundWorkData?

    public init(phase: Phase, data: BackgroundWorkData?) {
        self.phase = phase
        self.data = data
    }
}

// MARK: - Projection (web `hasJobs`/`count`/sort + P4 leaf contract)

/// The pure projection from the coalesced snapshot to the resolved view-state — the native port of the
/// web derivation: jobs are sorted oldest-first (web `[...].sort((a, b) => a.startedAt.localeCompare(...))`,
/// stabilised by id), `hasJobs` (`jobs.length > 0`) selects the `.active` render, and when nothing is in
/// flight the P4 leaf states are chosen in the same precedence the sibling VersionSegment uses
/// (error → loading → empty). Unit tested across every phase + the sort.
public enum BackgroundWorkProjection {
    public static func resolve(_ snapshot: BackgroundWorkSnapshot) -> BackgroundWorkResolved {
        let jobs = sortedJobs(snapshot.jobs)
        if !jobs.isEmpty {
            return BackgroundWorkResolved(phase: .active, data: BackgroundWorkData(jobs: jobs, count: jobs.count))
        }
        if let message = nonEmpty(snapshot.errorMessage) {
            return BackgroundWorkResolved(phase: .error(message), data: nil)
        }
        if snapshot.isLoading {
            return BackgroundWorkResolved(phase: .loading, data: nil)
        }
        return BackgroundWorkResolved(phase: .empty, data: nil)
    }

    /// The web oldest-first sort (`a.startedAt.localeCompare(b.startedAt)`), stabilised by id so equal
    /// timestamps keep a deterministic order across renders.
    static func sortedJobs(_ jobs: [BackgroundJob]) -> [BackgroundJob] {
        jobs.sorted { lhs, rhs in
            if lhs.startedAt == rhs.startedAt {
                return lhs.id < rhs.id
            }
            return lhs.startedAt < rhs.startedAt
        }
    }

    /// Trims and nils-out an empty/whitespace string — the native peer of the web truthiness guards.
    static func nonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

// MARK: - Summary (web `count === 1 ? 'one' : 'many'`)

/// Builds the segment's task-count summary — the native port of the web `summary`:
/// `count === 1 ? t('statusBar.background.one', '1 task') : t('statusBar.background.many', '{{count}} tasks',
/// { count })`. The caller passes the already-bound resolver so the pure core needs no bundle.
public enum BackgroundWorkSummary {
    public static func text(count: Int, resolve: BackgroundWorkResolve) -> String {
        if count == 1 {
            return resolve("statusBar.background.one", "1 task")
        }
        let template = resolve("statusBar.background.many", "{{count}} tasks")
        return template.replacingOccurrences(of: "{{count}}", with: String(count))
    }
}

// MARK: - Accessibility (web tooltip + aria-label)

/// Builds the segment's tooltip and VoiceOver label from already-localised fragments, so the spoken /
/// hovered content is asserted without rendering the view. Mirrors the web `<Tooltip content>` row
/// (`{tooltip} · {summary}`) and the `aria-label` (`{aria}: {summary}`) exactly.
public enum BackgroundWorkAccessibility {
    /// The hover tooltip — the web `` `{t('…tooltip')} · {summary}` `` row.
    public static func tooltip(prefix: String, summary: String) -> String {
        "\(prefix) · \(summary)"
    }

    /// The VoiceOver label — the web `` aria-label={`${t('…aria')}: ${summary}`} ``.
    public static func segmentLabel(aria: String, summary: String) -> String {
        "\(aria): \(summary)"
    }
}
