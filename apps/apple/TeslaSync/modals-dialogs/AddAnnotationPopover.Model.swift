//
//  AddAnnotationPopover.Model.swift
//  TeslaSync — P4 modal/dialog · 0002 · AddAnnotationPopover (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `AddAnnotationPopover` owns its own form
//  state (`label`, `category`, `description`, `editedDate`), re-syncs the date field whenever the
//  popover re-opens with a fresh `timestamp` (the `useEffect`), validates on submit (non-empty
//  label + resolved `occurredAt`), and calls `onAdd` / `onCancel`. The native surface reproduces that
//  whole lifecycle here: an `AddAnnotationSource` pushes the resolved draft context + freshness, and
//  the model owns the resolved `AddAnnotationPhase`, the form field state, the submit predicate, and
//  the command seams for SwiftUI to bind. No persistence access and no annotation mutation live in
//  the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to an `AddAnnotationSource`, holds the latest
/// draft context + freshness, owns the editable form fields, exposes the resolved render phase + the
/// submit predicate, drives the submit / cancel command seams, and emits the P1/S11 `view.opened`
/// event once on first appearance.
@MainActor
@Observable
public final class AddAnnotationModel {
    // Load + freshness (from the source)
    public private(set) var phase: AddAnnotationPhase = .loading
    public private(set) var connection: AddAnnotationConnection = .live
    public private(set) var context: AddAnnotationDraftContext?
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Form fields (web `useState`)
    public var label = ""
    public var category: AddAnnotationCategory = .milestone
    public var annotationDescription = ""
    public var editedDate = ""

    /// The query failure message kept while a cached context remains on screen, so the content branch
    /// can surface the inline error above the form (web reload-failure-with-cached-context).
    public private(set) var loadFailure: String?

    @ObservationIgnored private let source: any AddAnnotationSource
    @ObservationIgnored private let telemetry: any AddAnnotationTelemetry
    @ObservationIgnored private let controller: any AddAnnotationController
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var lastSyncedTimestamp: String?

    public init(
        source: any AddAnnotationSource,
        telemetry: any AddAnnotationTelemetry = OSLogAddAnnotationTelemetry(),
        controller: any AddAnnotationController = OSLogAddAnnotationController(),
        localize: @escaping (String, String) -> String = AddAnnotationStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.controller = controller
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (categories + validation + a11y)

    /// The category pill descriptors in web `CATEGORY_OPTIONS` order.
    public var categoryOptions: [AddAnnotationCategoryOption] {
        AddAnnotationCategory.order.map(\.option)
    }

    /// Whether the date field is editable (web `editableDate` prop).
    public var editableDate: Bool {
        context?.editableDate ?? false
    }

    /// The fixed timestamp string shown read-only when the date is not editable (web `timestamp`).
    public var fixedTimestamp: String {
        context?.timestamp ?? ""
    }

    /// The `occurredAt` the current fields resolve to (web `handleSubmit`).
    public var occurredAt: String {
        AddAnnotationProjection.occurredAt(
            editableDate: editableDate,
            editedDate: editedDate,
            timestamp: fixedTimestamp
        )
    }

    /// Whether the Add button is enabled (web `disabled={!label.trim()}` + the `occurredAt` guard).
    public var canSubmit: Bool {
        AddAnnotationProjection.canSubmit(label: label, occurredAt: occurredAt)
    }

    /// The inline reload error shown above the form (web cached-context-with-failure), present only
    /// while the form is on screen despite a failed reload.
    public var inlineErrorMessage: String? {
        guard case .content = phase else { return nil }
        return loadFailure
    }

    /// The VoiceOver summary for the dialog.
    public var accessibilitySummary: String {
        AddAnnotationAccessibility.summary(localize: localize)
    }

    /// One category pill's VoiceOver label (name + selected status).
    public func accessibilityCategoryLabel(for option: AddAnnotationCategoryOption) -> String {
        AddAnnotationAccessibility.categoryLabel(
            option,
            selected: option.category == category,
            localize: localize
        )
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AddAnnotationSurface.slug)
        source.start()
    }

    /// Stops observing the upstream context feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-resolves the draft context (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Commands (web `handleSubmit` / `handleClose`)

    /// Validates + submits the draft (web `handleSubmit`): builds `occurredAt`, hands the draft to
    /// the controller (web `onAdd`), then resets the fields. No-op when the guard fails.
    public func submit() {
        guard let draft = AddAnnotationProjection.draft(
            label: label,
            category: category,
            description: annotationDescription,
            occurredAt: occurredAt
        ) else { return }
        controller.submit(draft: draft)
        resetFields()
    }

    /// Resets the fields and cancels (web `handleClose`: clears state then calls `onCancel`).
    public func cancel() {
        resetFields()
        controller.cancel()
    }

    // MARK: Snapshot application

    private func apply(_ update: AddAnnotationUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        context = update.context
        loadFailure = Self.failureMessage(update.status)
        syncEditedDateIfNeeded(for: update.context)
        phase = AddAnnotationProjection.resolvePhase(status: update.status, context: update.context)
        handleAutoRefresh(for: update.connection)
    }

    /// Re-syncs the date field to a freshly-anchored timestamp (web `useEffect` on `open`/
    /// `timestamp`), but never clobbers a date the user already edited for the same target.
    private func syncEditedDateIfNeeded(for context: AddAnnotationDraftContext?) {
        guard let context else { return }
        guard context.timestamp != lastSyncedTimestamp else { return }
        lastSyncedTimestamp = context.timestamp
        editedDate = AddAnnotationDateValue.inputValue(fromTimestamp: context.timestamp)
    }

    /// Clears the form back to web defaults (`label=''`, `category='milestone'`, `description=''`).
    private func resetFields() {
        label = ""
        category = .milestone
        annotationDescription = ""
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: AddAnnotationLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached context on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: AddAnnotationConnection) {
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
