//
//  TourOverlay.Model.swift
//  TeslaSync — P4 shared surface · 0145 · TourOverlay (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `TourOverlay` is fed by `useTour`, which
//  owns the active step, the resized target rect, and the step index / count, and exposes `next` /
//  `prev` / `skip`. The native surface reproduces that whole contract here: a `TourOverlaySource` pushes
//  the resolved step + anchor rect + index/count + freshness, the model owns the resolved
//  `TourOverlayPhase` plus the projected spotlight / tooltip-layout / progress-dot / nav derivations for
//  SwiftUI to render, forwards `next` / `prev` / `skip` to the control seam, auto-refreshes once when
//  the live state goes stale, and emits the P1/S11 `view.opened` event once on first appearance. No tour
//  engine and no element geometry live in the view.
//

import CoreGraphics
import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `TourOverlaySource`, holds the latest step +
/// anchor + index/count + freshness, exposes the resolved render phase + the pure tour derivations,
/// drives the next / prev / skip command seam, and emits `view.opened` once on first appearance.
@MainActor
@Observable
public final class TourOverlayModel {
    // Load + freshness (from the source)
    public private(set) var phase: TourOverlayPhase = .loading
    public private(set) var connection: TourOverlayConnection = .live
    public private(set) var step: TourOverlayStep?
    public private(set) var targetRect: TourOverlayTargetRect?
    public private(set) var currentStep = 0
    public private(set) var totalSteps = 0
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The query-failure message kept while a cached anchor remains on screen, so the data branch can
    /// surface the inline failure above the tour controls (web refresh-failure-with-cached-anchor).
    public private(set) var loadFailure: String?

    @ObservationIgnored private let source: any TourOverlaySource
    @ObservationIgnored private let telemetry: any TourOverlayTelemetry
    @ObservationIgnored private let controller: any TourOverlayController
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TourOverlaySource,
        telemetry: any TourOverlayTelemetry = OSLogTourOverlayTelemetry(),
        controller: any TourOverlayController = OSLogTourOverlayController(),
        localize: @escaping (String, String) -> String = TourOverlayStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.controller = controller
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (spotlight + tooltip + dots + nav + a11y)

    /// Whether the overlay has a renderable anchor — the native `step != nil && targetRect != nil`, the
    /// web `if (!targetRect) return null` guard.
    public var hasAnchor: Bool {
        step != nil && targetRect != nil
    }

    /// The spotlight cutout frame for the current anchor (web `spotlight`), or `nil` when unanchored.
    public var spotlight: TourOverlaySpotlight? {
        targetRect.map { TourOverlaySpotlightGeometry.frame(for: $0) }
    }

    /// The progress-dot row for the current step (web progress dots).
    public var progressDots: [TourOverlayProgressDot] {
        TourOverlayProgress.dots(currentStep: currentStep, totalSteps: totalSteps)
    }

    /// The resolved navigation affordances for the current step (web back / skip / next-or-finish).
    public var navModel: TourOverlayNavModel {
        TourOverlayNav.model(currentStep: currentStep, totalSteps: totalSteps)
    }

    /// The "n / total" counter text (web `{currentStep + 1} / {totalSteps}`).
    public var stepCounterText: String {
        TourOverlayStepCounter.text(currentStep: currentStep, totalSteps: totalSteps)
    }

    /// The tooltip dialog VoiceOver / `aria-label` (web `tour.dialogLabel`).
    public var dialogAccessibilityLabel: String {
        TourOverlayAccessibility.dialogLabel(
            currentStep: currentStep,
            totalSteps: totalSteps,
            localize: localize
        )
    }

    /// The inline refresh-failure shown above the controls while a cached anchor is still on screen
    /// (web cached-anchor-with-failure), present only in the data phase.
    public var inlineErrorMessage: String? {
        guard case .data = phase else { return nil }
        return loadFailure
    }

    /// The tooltip's resolved CSS-style anchors for the given container size (web
    /// `getTooltipPosition(step.placement, rect)`), or `nil` when unanchored.
    public func tooltipLayout(viewport: TourOverlayViewport) -> TourOverlayTooltipLayout? {
        guard let step, let targetRect else { return nil }
        return TourOverlayTooltipPositioner.layout(
            placement: step.placement,
            rect: targetRect,
            viewport: viewport
        )
    }

    /// Resolves the tooltip's top-left origin for the given container + measured tooltip size.
    public func tooltipOrigin(viewport: TourOverlayViewport, tooltipSize: CGSize) -> CGPoint? {
        guard let layout = tooltipLayout(viewport: viewport) else { return nil }
        return TourOverlayTooltipPositioner.origin(
            layout: layout,
            viewport: viewport,
            tooltipSize: tooltipSize
        )
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TourOverlaySurface.slug)
        source.start()
    }

    /// Stops observing the upstream tour feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-measures / re-reads the tour state (web `updateRect`, the freshness chip, the error retry).
    public func refresh() {
        source.refresh()
    }

    // MARK: Commands (web `onNext` / `onPrev` / `onSkip`)

    /// Advances to the next step (web `onNext`). The tour engine re-pushes a fresh snapshot.
    public func next() {
        controller.next()
    }

    /// Returns to the previous step (web `onPrev`).
    public func prev() {
        controller.prev()
    }

    /// Skips / closes the tour (web `onSkip`).
    public func skip() {
        controller.skip()
    }

    // MARK: Snapshot application

    private func apply(_ update: TourOverlayUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        step = update.step
        targetRect = update.targetRect
        currentStep = update.currentStep
        totalSteps = update.totalSteps
        loadFailure = Self.failureMessage(update.status)
        phase = TourOverlayProjection.resolve(status: update.status, hasAnchor: hasAnchor)
        handleAutoRefresh(for: update.connection)
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: TourOverlayLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached anchor on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: TourOverlayConnection) {
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
