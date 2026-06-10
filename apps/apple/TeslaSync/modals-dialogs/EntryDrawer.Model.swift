//
//  EntryDrawer.Model.swift
//  TeslaSync — P4 modal / dialog · 0018 · EntryDrawer (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `EntryDrawer` is props-driven: a
//  parent passes the cached `summary`, the lazy-loaded `full` entry, the `loading` / `replayEnabled`
//  / `replayInFlight` flags, and the `onClose` / `onReplay` callbacks. The native surface reproduces
//  that whole lifecycle here — an `EntryDrawerSource` pushes the resolved summary + full + flags +
//  freshness, and the model owns the resolved `EntryDrawerPhase`, the decoded payloads, the active
//  tab, the KVList rows, the replay-enablement rule, and the copy + replay command seams, emitting
//  the P1/S11 `view.opened` event once on first appearance. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to an `EntryDrawerSource`, holds the latest
/// summary + full entry + freshness, decodes the two payload blobs once per snapshot, owns the
/// active tab + the copied flag, exposes the resolved phase + KVList rows + replay enablement, and
/// drives the copy + replay command seams.
@MainActor
@Observable
public final class EntryDrawerModel {
    // Load + freshness (from the source)
    public private(set) var loadStatus: EntryDrawerLoadStatus = .loading
    public private(set) var connection: EntryDrawerConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Entry (web `summary` / `full`; `head = full ?? summary`)
    public private(set) var summary: EntryDrawerSummary?
    public private(set) var full: EntryDrawerFull?
    public private(set) var replayEnabled = true
    public private(set) var replayInFlight = false

    // Resolved render state
    public private(set) var phase: EntryDrawerPhase = .loading
    public private(set) var rows: [EntryDrawerKVRow] = []
    public private(set) var inlineErrorMessage: String?

    // Decoded payloads (web `innerText` / `rawText`)
    public private(set) var innerText = ""
    public private(set) var rawText = ""

    // Interactive state
    public private(set) var activeTab: EntryDrawerTab = .inner
    public private(set) var copied = false

    @ObservationIgnored private let source: any EntryDrawerSource
    @ObservationIgnored private let telemetry: any EntryDrawerTelemetry
    @ObservationIgnored private let clipboard: any EntryDrawerClipboard
    @ObservationIgnored private let replayAction: any EntryDrawerReplayAction
    @ObservationIgnored let dates: any EntryDrawerDateFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any EntryDrawerSource,
        telemetry: any EntryDrawerTelemetry = OSLogEntryDrawerTelemetry(),
        clipboard: any EntryDrawerClipboard = SystemEntryDrawerClipboard(),
        replayAction: any EntryDrawerReplayAction = OSLogEntryDrawerReplayAction(),
        dates: any EntryDrawerDateFormatting = DefaultEntryDrawerDateFormatting(),
        localize: @escaping (String, String) -> String = EntryDrawerStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.clipboard = clipboard
        self.replayAction = replayAction
        self.dates = dates
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived

    /// The summary head used for the title + KVList + replay enablement (web `full ?? summary`).
    public var head: EntryDrawerSummary? {
        full?.summary ?? summary
    }

    /// Whether a summary head is resolved (web `head` truthiness).
    public var hasHead: Bool {
        head != nil
    }

    /// The drawer title (web `head ? 'DLQ entry #{{id}}' : 'DLQ entry'`).
    public var title: String {
        EntryDrawerProjection.title(hasHead: hasHead, id: head?.id ?? 0, localize: localize)
    }

    /// Web `replayDisabled = !replayEnabled || !head?.replayable || replayInFlight || loading`.
    public var replayDisabled: Bool {
        EntryDrawerProjection.replayDisabled(
            replayEnabled: replayEnabled,
            replayable: head?.replayable ?? false,
            replayInFlight: replayInFlight,
            loading: loadStatus == .loading
        )
    }

    /// The two payload tabs (web `tabs`).
    public var tabs: [EntryDrawerTab] {
        EntryDrawerTab.allCases
    }

    /// The `<pre>` body text for the active tab (decoded UTF-8, else the binary-fallback message).
    public var payloadDisplayText: String {
        EntryDrawerProjection.displayText(
            tab: activeTab,
            decoded: decoded(for: activeTab),
            byteSize: byteSize(for: activeTab),
            localize: localize
        )
    }

    /// The localized label for a tab.
    public func tabLabel(_ tab: EntryDrawerTab) -> String {
        localize(tab.labelKey, tab.labelFallback)
    }

    /// The CopyButton text for the active tab (decoded text, else the raw base64 blob).
    public var activeCopyText: String {
        EntryDrawerProjection.copyText(decoded: decoded(for: activeTab), base64: base64(for: activeTab))
    }

    // MARK: Accessibility

    /// The VoiceOver dialog summary.
    public var accessibilitySummary: String {
        EntryDrawerAccessibility.summary(hasHead: hasHead, id: head?.id ?? 0, localize: localize)
    }

    /// The close button VoiceOver label.
    public var closeAccessibilityLabel: String {
        EntryDrawerAccessibility.closeLabel(localize: localize)
    }

    /// The replay button VoiceOver label.
    public var replayAccessibilityLabel: String {
        EntryDrawerAccessibility.replayLabel(localize: localize)
    }

    /// The payload region VoiceOver label (names the active tab).
    public var payloadAccessibilityLabel: String {
        EntryDrawerAccessibility.payloadLabel(tab: activeTab, localize: localize)
    }

    /// The copy button VoiceOver label (reflects the copied state).
    public var copyAccessibilityLabel: String {
        EntryDrawerAccessibility.copyLabel(copied: copied, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EntryDrawerSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying full-entry fetch (the error-state retry / the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    // MARK: Commands

    /// Switches the payload tab (web `setActiveTab`); resets the transient copied flag.
    public func selectTab(_ tab: EntryDrawerTab) {
        guard tab != activeTab else { return }
        activeTab = tab
        copied = false
    }

    /// Copies the active tab's payload to the clipboard (web `CopyButton`) and flips the copied
    /// flag so the button shows "Copied".
    public func copyActivePayload() {
        clipboard.copy(activeCopyText)
        copied = true
    }

    /// Resets the copied flag back to "Copy" (the view calls this after the brief confirmation
    /// window, web `setTimeout`).
    public func resetCopied() {
        copied = false
    }

    /// Re-publishes the entry to its source topic through the action seam (web `onReplay`). No-op
    /// while the replay is disabled.
    public func replay() {
        guard !replayDisabled, let head else { return }
        replayAction.replay(id: head.id)
    }

    // MARK: Snapshot application

    private func apply(_ update: EntryDrawerUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        summary = update.summary
        full = update.full
        replayEnabled = update.replayEnabled
        replayInFlight = update.replayInFlight
        innerText = update.full.map { EntryDrawerPayloadDecoder.decodeUTF8($0.innerPayloadBase64) } ?? ""
        rawText = update.full.map { EntryDrawerPayloadDecoder.decodeUTF8($0.rawPayloadBase64) } ?? ""
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Recomputes the resolved phase, the KVList rows, and the inline-error envelope from the
    /// current load status + entry.
    private func recompute() {
        phase = EntryDrawerProjection.resolvePhase(
            status: loadStatus,
            hasSummary: summary != nil,
            hasFull: full != nil
        )
        rows = head.map { resolveRows(for: $0) } ?? []
        inlineErrorMessage = EntryDrawerProjection.inlineFailure(status: loadStatus, hasHead: hasHead)
    }

    private func resolveRows(for head: EntryDrawerSummary) -> [EntryDrawerKVRow] {
        EntryDrawerProjection.rows(
            for: head,
            localize: localize,
            absolute: { [dates] date in dates.absolute(date) }
        )
    }

    private func decoded(for tab: EntryDrawerTab) -> String {
        tab == .inner ? innerText : rawText
    }

    private func base64(for tab: EntryDrawerTab) -> String? {
        tab == .inner ? full?.innerPayloadBase64 : full?.rawPayloadBase64
    }

    private func byteSize(for tab: EntryDrawerTab) -> Int {
        tab == .inner ? (head?.innerPayloadSize ?? 0) : (head?.rawPayloadSize ?? 0)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached entry and does not
    /// refetch.
    private func handleAutoRefresh(for connection: EntryDrawerConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
