//
//  FormatterPrefsBridge.Model.swift
//  TeslaSync — P4 shared surface · 0146 · FormatterPrefsBridge (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  formatter-preferences bridge. The view binds through `FormatterPrefsBridgeModel`; no networking
//  lives in the view. A source emits the settings + connectivity snapshot, the model recomputes the
//  resolved projection, emits `view.opened` once on appear, applies the resolved locale + precision to
//  the formatter globals with the verbatim web de-dupe (write only when the value changed AND differs
//  from the current global), refetches on a settings-changed broadcast (the web
//  `qc.invalidateQueries(['settings'])`), and fires a one-shot refresh when the query transitions to
//  stale (the P4 leaf "stale → auto-refresh" contract).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol FormatterPrefsBridgeTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogFormatterPrefsBridgeTelemetry: FormatterPrefsBridgeTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `FormatterPrefsBridgeSource`, recomputes the
/// resolved projection on every snapshot, exposes the render `phase` + resolved applied prefs + the
/// `connection` axis + the static `config`, emits the `view.opened` diagnostics event once on appear,
/// applies the resolved locale + precision to the formatter globals through the injected applier (with
/// the web de-dupe), subscribes to the settings-changed broadcast (refetch on signal), and auto-
/// refreshes once when the query transitions to stale.
@MainActor
@Observable
public final class FormatterPrefsBridgeModel {
    public private(set) var resolved: FormatterPrefsBridgeResolved

    public var phase: FormatterPrefsBridgeResolved.Phase {
        resolved.phase
    }

    /// The resolved formatter prefs (locale + precision) currently applied, or `nil` in a chrome phase.
    public var applied: FormatterPrefsBridgeApplied? {
        resolved.applied
    }

    /// Whether the snapshot is offline — surfaced so the view can decorate the applied card.
    public var offline: Bool {
        resolved.offline
    }

    /// The freshness axis — drives the stale / offline freshness chip.
    public var connection: FormatterPrefsBridgeConnection {
        resolved.connection
    }

    public let config: FormatterPrefsBridgeConfig

    @ObservationIgnored private let source: any FormatterPrefsBridgeSource
    @ObservationIgnored private let applier: any FormatterPrefsBridgeApplier
    @ObservationIgnored private let broadcast: any FormatterPrefsBridgeBroadcast
    @ObservationIgnored private let telemetry: any FormatterPrefsBridgeTelemetry
    @ObservationIgnored private let strings: FormatterPrefsBridgeResolve
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var lastLocale: String?
    @ObservationIgnored private var lastPrecision: Int?
    @ObservationIgnored private var lastConnection: FormatterPrefsBridgeConnection = .live

    public init(
        source: any FormatterPrefsBridgeSource,
        config: FormatterPrefsBridgeConfig = .default,
        applier: any FormatterPrefsBridgeApplier = FormatterPrefsBridgeGlobalsApplier(),
        broadcast: any FormatterPrefsBridgeBroadcast = NotificationCenterFormatterPrefsBridgeBroadcast(),
        telemetry: any FormatterPrefsBridgeTelemetry = OSLogFormatterPrefsBridgeTelemetry(),
        strings: @escaping FormatterPrefsBridgeResolve = FormatterPrefsBridgeStrings.string
    ) {
        self.source = source
        self.config = config
        self.applier = applier
        self.broadcast = broadcast
        self.telemetry = telemetry
        self.strings = strings
        resolved = FormatterPrefsBridgeProjection.resolve(
            FormatterPrefsBridgeInput(),
            config: config,
            strings: strings
        )
        source.onUpdate = { [weak self] input in self?.apply(input) }
        broadcast.onSettingsChanged = { [weak self] in self?.refresh() }
    }

    /// Begins observing the settings feed + the settings-changed broadcast and emits the `view.opened`
    /// diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: FormatterPrefsBridgeMeta.surfaceSlug)
        }
        broadcast.start()
        source.start()
    }

    /// Stops observing the feed + broadcast.
    public func stop() {
        started = false
        broadcast.stop()
        source.stop()
    }

    /// Re-requests the settings snapshot — the web `qc.invalidateQueries(['settings'])` (the
    /// settings-changed broadcast path) and the stale auto-refresh + the manual retry.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: FormatterPrefsBridgeInput) {
        resolved = FormatterPrefsBridgeProjection.resolve(input, config: config, strings: strings)
        applyFormatterGlobals(resolved.applied)
        autoRefreshIfBecameStale(input)
    }

    /// Applies the resolved locale + precision to the formatter globals — the verbatim port of the web
    /// bridge effect: write a value only when it changed since the bridge last wrote it AND it differs
    /// from the current global; on the first resolve, record the observed value even when no write was
    /// needed (so a later identical refetch doesn't trigger a redundant write). A chrome phase carries
    /// no resolved value (web effect early-returns while `settings` is undefined), so nothing is
    /// written.
    private func applyFormatterGlobals(_ applied: FormatterPrefsBridgeApplied?) {
        guard let applied else { return }
        let locale = applied.locale
        if locale != lastLocale, locale != applier.currentLocale() {
            applier.apply(locale: locale)
            lastLocale = locale
        } else if lastLocale == nil {
            lastLocale = locale
        }
        let precision = applied.precision
        if precision != lastPrecision, precision != applier.currentPrecision() {
            applier.apply(precision: precision)
            lastPrecision = precision
        } else if lastPrecision == nil {
            lastPrecision = precision
        }
    }

    /// One-shot auto-refresh on the rising edge into the stale window (P4 leaf contract). Never armed
    /// while offline — there is no connection to re-fetch over.
    private func autoRefreshIfBecameStale(_ input: FormatterPrefsBridgeInput) {
        let previous = lastConnection
        lastConnection = input.connection
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the views hold no hardcoded
/// literals. The web bridge renders `null` and so contributes no `t()` keys of its own; these are the
/// native P4 leaf chrome keys (loading / defaults / unavailable / freshness / a11y), kept in the
/// per-surface "FormatterPrefsBridge" table and folded into the app `Localizable.xcstrings` catalog at
/// integration time.
public enum FormatterPrefsBridgeStrings {
    public static let table = "FormatterPrefsBridge"

    public static let string: FormatterPrefsBridgeResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
