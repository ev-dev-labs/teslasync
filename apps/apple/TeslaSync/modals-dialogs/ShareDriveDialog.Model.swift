//
//  ShareDriveDialog.Model.swift
//  TeslaSync — P4 modal / dialog · 0028 · ShareDriveDialog (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `ShareDriveDialog` owns its form state
//  (`shareUrl`, `includeSpeed`, `includeTelemetry`, `expiryDays`, `title`) in local state, lists the
//  drive's `useShareLinks` rows, POSTs through `useCreateShareLink` (swapping to the result panel on
//  success), revokes through `useRevokeShareLink`, and copies links via `CopyButton`. The native
//  surface reproduces that whole lifecycle here: a `ShareDriveSource` pushes the links + freshness, and
//  the model owns the resolved links phase, the editable form fields, the create (pending → result)
//  lifecycle, the per-row revoke state, the clipboard commands, the stale auto-refresh, and the close.
//  No network lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `ShareDriveSource`, holds the latest links +
/// freshness, owns the editable form fields + the create-result panel, exposes the resolved links
/// phase + the create / revoke state, drives the create / revoke / copy command seams, and emits the
/// P1/S11 `view.opened` event once on first appearance.
@MainActor
@Observable
public final class ShareDriveModel {
    // Load + freshness (from the source)
    public private(set) var linksPhase: ShareLinksPhase = .loading
    public private(set) var connection: ShareDriveConnection = .live
    public private(set) var links: [ShareLink] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Form fields (web `useState`)
    public var title = ""
    public var includeSpeed = true
    public var includeTelemetry = false
    public var expiry: ShareExpiry = .days30

    // Create result + lifecycle (web `shareUrl` / `createShare`)
    public private(set) var shareURL: String?
    public private(set) var isCreating = false
    public private(set) var createError: String?

    // Revoke lifecycle (web `revokeShare`)
    public private(set) var revokingTokens: Set<String> = []
    public private(set) var actionError: String?

    // Inline reload error kept while a cached list survives a failed reload
    public private(set) var loadFailure: String?
    public private(set) var didFinish = false

    @ObservationIgnored private let driveId: String
    @ObservationIgnored private let source: any ShareDriveSource
    @ObservationIgnored private let telemetry: any ShareDriveTelemetry
    @ObservationIgnored private let controller: any ShareDriveController
    @ObservationIgnored private let clipboard: any ShareDriveClipboard
    @ObservationIgnored private let urlBuilder: any ShareDriveURLBuilding
    @ObservationIgnored private let dates: any ShareDriveDateFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        driveId: String,
        source: any ShareDriveSource,
        telemetry: any ShareDriveTelemetry = OSLogShareDriveTelemetry(),
        controller: any ShareDriveController = OSLogShareDriveController(),
        clipboard: any ShareDriveClipboard = SystemShareDriveClipboard(),
        urlBuilder: any ShareDriveURLBuilding = DefaultShareDriveURLBuilder(),
        dates: any ShareDriveDateFormatting = DefaultShareDriveDateFormatting(),
        localize: @escaping (String, String) -> String = ShareDriveStrings.string,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.driveId = driveId
        self.source = source
        self.telemetry = telemetry
        self.controller = controller
        self.clipboard = clipboard
        self.urlBuilder = urlBuilder
        self.dates = dates
        self.localize = localize
        self.now = now
        source.onUpdate = { [weak self] update in self?.apply(update) }
        controller.onCreateResult = { [weak self] outcome in self?.applyCreateOutcome(outcome) }
        controller.onRevokeResult = { [weak self] outcome in self?.applyRevokeOutcome(outcome) }
    }

    // MARK: Derived (web render conditions)

    /// Whether the result panel is shown instead of the create form (web `!shareUrl`).
    public var hasResult: Bool {
        shareURL != nil
    }

    /// The result panel's read-only URL field value (web `<Input value={shareUrl} readOnly />`).
    public var resultURL: String {
        shareURL ?? ""
    }

    /// Whether the "Generate Link" action is permitted (web button is live unless the mutation pends).
    public var canGenerate: Bool {
        !isCreating
    }

    /// The expiry picker's choices (web `<Select options>`).
    public var expiryOptions: [ShareExpiry] {
        ShareExpiry.allCases
    }

    /// The expiry picker's current display label.
    public var expiryDisplay: String {
        localize(expiry.labelKey, expiry.labelFallback)
    }

    /// The presentation rows for the loaded links (web `shares.map(...)`): the expiry status per the
    /// injected clock + the composed `${origin}/s/${token}` URL.
    public var rows: [ShareLinkRow] {
        ShareDriveProjection.rows(from: links, now: now()) { [urlBuilder] token in
            urlBuilder.url(forToken: token)
        }
    }

    /// The inline reload error shown above the list (web cached-list-with-failure), present only while
    /// rows remain on screen despite a failed reload.
    public var inlineLoadError: String? {
        guard case .content = linksPhase else { return nil }
        return loadFailure
    }

    /// The dialog container's VoiceOver label.
    public var accessibilityDialogLabel: String {
        ShareDriveAccessibility.dialogLabel(localize: localize)
    }

    // MARK: Row display (DRY across the row body + its VoiceOver label)

    /// The row's title, falling back to the "Untitled share" copy (web `share.title ?? ...`).
    public func rowTitle(_ row: ShareLinkRow) -> String {
        row.isUntitled ? localize("share.untitled", "Untitled share") : (row.title ?? "")
    }

    /// The row's "{n} views" copy (web `{share.views} {t('share.views', 'views')}`).
    public func viewsText(_ count: Int) -> String {
        "\(count) \(localize("share.views", "views"))"
    }

    /// The row's expiry status copy (web `isExpired ? 'Expired' : expires_at ? 'Expires {date}' : 'No
    /// expiry'`).
    public func expiryText(_ state: ShareExpiryState) -> String {
        switch state {
        case .expired:
            return localize("share.expired", "Expired")
        case let .active(date):
            let template = localize("share.expiresOn", "Expires %@")
            return String(format: template, dates.medium(date))
        case .none:
            return localize("share.noExpiry", "No expiry")
        }
    }

    /// One row's VoiceOver summary (title + tally + expiry).
    public func rowAccessibilityLabel(_ row: ShareLinkRow) -> String {
        ShareDriveAccessibility.rowLabel(
            title: rowTitle(row),
            views: viewsText(row.views),
            expiry: expiryText(row.expiry)
        )
    }

    /// Whether the given row's revoke is in flight (drives its spinner).
    public func isRevoking(_ token: String) -> Bool {
        revokingTokens.contains(token)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ShareDriveSurface.slug)
        source.start()
    }

    /// Stops observing the upstream links feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-resolves the links + freshness (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Create (web `handleCreate`)

    /// Builds the request and submits it (web `handleCreate` → `createShare.mutateAsync`). Guarded
    /// against a double submit while pending.
    public func generate() {
        guard !isCreating else { return }
        createError = nil
        let input = ShareDriveProjection.createInput(
            title: title,
            includeSpeed: includeSpeed,
            includeTelemetry: includeTelemetry,
            expiry: expiry
        )
        isCreating = true
        controller.create(input: input, driveId: driveId)
    }

    /// Resets the result panel back to the create form (web `setShareUrl(null)` / "Create another link").
    public func createAnother() {
        shareURL = nil
        createError = nil
    }

    /// Copies the freshly-created share URL to the clipboard (web result-panel `CopyButton`).
    public func copyResultURL() {
        guard let shareURL else { return }
        clipboard.copy(shareURL)
    }

    // MARK: Revoke + copy (web `handleRevoke` / row `CopyButton`)

    /// Copies one existing row's public URL (web row `CopyButton` over `${origin}/s/${token}`).
    public func copyRowURL(_ token: String) {
        clipboard.copy(urlBuilder.url(forToken: token))
    }

    /// Revokes a share link (web `handleRevoke` → `revokeShare.mutateAsync(token)`). Guarded against a
    /// double tap; the row shows a spinner until the outcome arrives.
    public func revoke(_ token: String) {
        guard !revokingTokens.contains(token) else { return }
        actionError = nil
        revokingTokens.insert(token)
        controller.revoke(token: token)
    }

    // MARK: Outcomes (web mutation onSuccess / onError)

    private func applyCreateOutcome(_ outcome: ShareCreateOutcome) {
        isCreating = false
        switch outcome {
        case let .success(token):
            shareURL = urlBuilder.url(forToken: token)
            source.refresh() // web invalidateQueries → the new link appears in the list
        case let .failure(message):
            createError = message
        }
    }

    private func applyRevokeOutcome(_ outcome: ShareRevokeOutcome) {
        switch outcome {
        case let .success(token):
            revokingTokens.remove(token)
            source.refresh() // web invalidateQueries → the revoked row drops out
        case let .failure(token, message):
            revokingTokens.remove(token)
            actionError = message
        }
    }

    // MARK: Close (web `handleClose`)

    /// Closes without leaving the result panel sticky (web `handleClose`: reset `shareUrl` + `title`,
    /// then `onClose`). Drives dismissal through `didFinish`.
    public func close() {
        shareURL = nil
        title = ""
        createError = nil
        actionError = nil
        didFinish = true
    }

    // MARK: Snapshot application

    private func apply(_ update: ShareDriveUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        links = update.links
        loadFailure = Self.failureMessage(update.status)
        linksPhase = ShareDriveProjection.resolveLinksPhase(status: update.status, links: update.links)
        // Drop any revoke spinner whose row no longer exists (covers the post-revoke refetch).
        revokingTokens = revokingTokens.intersection(Set(update.links.map(\.token)))
        handleAutoRefresh(for: update.connection)
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: ShareLinksLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached list on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: ShareDriveConnection) {
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
