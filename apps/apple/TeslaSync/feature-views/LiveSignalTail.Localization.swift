//
//  LiveSignalTail.Localization.swift
//  TeslaSync — P4 feature view · 0263 · LiveSignalTail (Apple)
//
//  The P1/S10 localization facade + the testable accessibility summary. Both are
//  Foundation-only so the strings resolve through the per-surface catalog table (no
//  hardcoded literals in the view) and the VoiceOver content can be unit-tested
//  without rendering.
//
//  The first block is the exact set of keys extracted from the web source
//  (features/telemetry/components/LiveSignalTail.tsx). The rest backs the
//  native-only chrome (error/retry, connectivity banners, paused chip) and the
//  relative-age labels the web delegates to the shared `<FreshnessIndicator>`.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "LiveSignalTail" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum LiveSignalTailStrings {
    public static let table = "LiveSignalTail"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: Column headers (web source)

    public static var columnTime: String {
        string("liveMonitor.time", "Time")
    }

    public static var columnSignal: String {
        string("liveMonitor.signal", "Signal")
    }

    public static var columnValue: String {
        string("liveMonitor.value", "Value")
    }

    public static var columnType: String {
        string("liveMonitor.type", "Type")
    }

    public static var columnFreshness: String {
        string("liveMonitor.freshness", "Freshness")
    }

    // MARK: Filter (web source)

    public static var filterPrompt: String {
        string("liveMonitor.filterPlaceholder", "Filter by signal name...") // parity:allow web i18n key
    }

    public static var filterAria: String {
        string("liveMonitor.filterLabel", "Filter signals")
    }

    // MARK: Controls (web source)

    public static var resume: String {
        string("liveMonitor.resume", "Resume")
    }

    public static var pause: String {
        string("liveMonitor.pause", "Pause")
    }

    public static var autoScroll: String {
        string("liveMonitor.autoScroll", "Auto-scroll")
    }

    public static var clear: String {
        string("liveMonitor.clear", "Clear")
    }

    // MARK: Stats (web source)

    public static var statRate: String {
        string("liveMonitor.sigPerSec", "Signals / sec")
    }

    public static var statBuffer: String {
        string("liveMonitor.bufferSize", "Buffer Size")
    }

    public static var statUnique: String {
        string("liveMonitor.uniqueSignals", "Unique Signals")
    }

    public static var statFiltered: String {
        string("liveMonitor.filtered", "Filtered")
    }

    // MARK: Empty messages (web source)

    public static var waiting: String {
        string("liveMonitor.waiting", "Waiting for signals…")
    }

    public static var noMatch: String {
        string("liveMonitor.noMatch", "No signals match filter")
    }

    // MARK: Native chrome — error + connectivity

    public static var errorTitle: String {
        string("liveMonitor.error.title", "Couldn't open the live signal stream")
    }

    public static var retry: String {
        string("liveMonitor.action.retry", "Retry")
    }

    public static var staleBanner: String {
        string("liveMonitor.banner.stale", "Reconnecting — values may be stale")
    }

    public static var offlineBanner: String {
        string("liveMonitor.banner.offline", "Offline — showing last known values")
    }

    public static var liveChip: String {
        string("liveMonitor.chip.live", "Live")
    }

    public static var pausedChip: String {
        string("liveMonitor.chip.paused", "Paused")
    }

    // MARK: Native chrome — relative age (web shared `formatAge`)

    public static var ageJustNow: String {
        string("liveMonitor.age.justNow", "just now")
    }

    public static func ageSeconds(_ value: Int) -> String {
        String(format: string("liveMonitor.age.seconds", "%llds ago"), value)
    }

    public static func ageMinutes(_ value: Int) -> String {
        String(format: string("liveMonitor.age.minutes", "%lldm ago"), value)
    }

    public static func ageHours(_ value: Int) -> String {
        String(format: string("liveMonitor.age.hours", "%lldh ago"), value)
    }

    public static var ageNone: String {
        string("liveMonitor.age.none", "—")
    }

    /// Formats a relative-age bucket into its localized label — the web shared
    /// `formatAge` output, with the bucketing proven separately in the adapter.
    public static func ageLabel(_ bucket: LiveSignalTailAge) -> String {
        switch bucket {
        case .none: ageNone
        case .justNow: ageJustNow
        case let .seconds(value): ageSeconds(value)
        case let .minutes(value): ageMinutes(value)
        case let .hours(value): ageHours(value)
        }
    }

    // MARK: Accessibility

    public static var tableLabel: String {
        string("liveMonitor.a11y.table", "Live signal tail")
    }

    public static var noTimestamp: String {
        string("liveMonitor.a11y.noTimestamp", "no timestamp")
    }

    /// VoiceOver value spoken for the whole tail: the buffered event count.
    public static func countSummary(_ count: Int) -> String {
        String(format: string("liveMonitor.a11y.count", "%lld buffered signals"), count)
    }

    /// The localized freshness word for VoiceOver (web dot status).
    public static func freshnessLabel(_ freshness: LiveSignalTailFreshness) -> String {
        switch freshness {
        case .fresh: string("liveMonitor.a11y.fresh", "fresh")
        case .stale: string("liveMonitor.a11y.stale", "stale")
        case .offline: string("liveMonitor.a11y.offline", "offline")
        case .unknown: string("liveMonitor.a11y.unknownFreshness", "unknown")
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver content for the tail + its rows. Pure + public so the a11y
/// content can be unit-tested without rendering the view.
public enum LiveSignalTailAccessibility {
    /// The tail's spoken value — the buffered row count, or the waiting message when
    /// nothing has been received yet.
    public static func tailSummary(rowCount: Int) -> String {
        rowCount == 0 ? LiveSignalTailStrings.waiting : LiveSignalTailStrings.countSummary(rowCount)
    }

    /// One row's combined VoiceOver label: time, name, value, kind, and the relative
    /// freshness — every column the web row exposes.
    public static func rowLabel(_ speech: LiveSignalTailRowSpeech) -> String {
        let when = speech.age.isEmpty ? LiveSignalTailStrings.noTimestamp : speech.age
        let freshWord = LiveSignalTailStrings.freshnessLabel(speech.freshness)
        return "\(speech.time), \(speech.name), \(speech.value), \(speech.kind.rawValue), \(when), \(freshWord)"
    }
}
