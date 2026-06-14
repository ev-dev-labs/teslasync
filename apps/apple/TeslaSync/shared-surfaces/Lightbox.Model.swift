//
//  Lightbox.Model.swift
//  TeslaSync — P4 shared surface · 0219 · Lightbox (Apple)
//
//  The surface's observable state-holder (P1/S8) the view binds through. The web `<Lightbox>` keeps its
//  open/close in caller state and owns its viewer interaction with `useState` (the current `index`, the
//  `zoom`, the `pan`, and the `decoded` flag); this model owns the exact same interaction state plus the
//  current image's load lifecycle the image-loader seam drives, the bounded navigation + stepped zoom routed
//  through ``LightboxProjector``, the dismiss closure (web `onClose`), and the P1/S11 `view.opened` emission.
//  No network and no host-dismissal live in the view. The web component has no data fetcher, so neither does
//  this holder — the only async work is loading the visible image's bytes (web `<img>` decode).
//

import Foundation
import Observation

/// The viewer's observable view-model. Owns the index / zoom / pan / load phase (web `useState`), re-derives
/// the pure ``LightboxProjection`` as an observed read (SwiftUI observation replaces the React re-render),
/// routes navigation + zoom through the pure projector, loads the visible image (web `<img>` + the
/// `new Image()` neighbour pre-warm) through the seam, and emits `view.opened` once per open transition.
@MainActor
@Observable
public final class LightboxModel {
    /// The current props (web props). Reading it (or a derived value) registers an observation dependency.
    public private(set) var input: LightboxInput
    /// The visible image index (web `index`).
    public private(set) var index: Int
    /// The zoom scale (web `zoom`), 1x–5x in 0.5 steps.
    public private(set) var zoom: Double
    /// The drag-to-pan offset applied while zoomed (web `pan`).
    public private(set) var pan: LightboxPan
    /// The visible image's load phase (web `decoded` + `onError`).
    public private(set) var loadPhase: LightboxLoadPhase

    @ObservationIgnored private var onClose: @MainActor () -> Void
    @ObservationIgnored private let loader: any LightboxImageLoading
    @ObservationIgnored private let telemetry: any LightboxTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var wasOpen = false
    @ObservationIgnored private var loadingSource: String?
    @ObservationIgnored private var loadToken = 0
    @ObservationIgnored var loadTask: Task<Void, Never>?

    public init(
        input: LightboxInput,
        onClose: @escaping @MainActor () -> Void = {},
        loader: any LightboxImageLoading = URLSessionLightboxImageLoader(),
        telemetry: any LightboxTelemetry = OSLogLightboxTelemetry()
    ) {
        self.input = input
        index = input.safeInitialIndex
        zoom = LightboxZoom.minimum
        pan = .zero
        loadPhase = .loading
        self.onClose = onClose
        self.loader = loader
        self.telemetry = telemetry
    }

    // MARK: Derived

    /// Whether the viewer is presented (web `open`).
    public var isOpen: Bool {
        input.isOpen
    }

    /// The image count (web `total`).
    public var total: Int {
        input.total
    }

    /// The visible image (web `images[min(index, total - 1)]`), or `nil` when the list is empty.
    public var currentImage: LightboxImage? {
        LightboxProjector.resolvedImage(images: input.images, index: index)
    }

    /// The resolved, view-ready viewer chrome — a pure function of the index / count / zoom / pan.
    public var projection: LightboxProjection {
        LightboxProjector.resolve(index: index, total: total, zoom: zoom, pan: pan)
    }

    // MARK: Lifecycle

    /// Begins the surface. Idempotent across the SwiftUI appear/disappear churn; the open transition (and its
    /// once-per-open `view.opened` + state reset) is handled by ``syncOpenState()``.
    public func start() {
        guard !started else { return }
        started = true
        syncOpenState()
    }

    /// Marks the surface inactive and cancels any in-flight image load. Leaves `wasOpen` intact so a later
    /// re-appear while still open does not re-emit `view.opened` or reset the viewer.
    public func stop() {
        started = false
        loadTask?.cancel()
    }

    /// Replaces the props (and optionally the dismiss closure) — the native peer of React re-rendering with
    /// new props. A non-nil `onClose` refreshes the closure (the prop path recreates it each parent render);
    /// the injected-model path passes `nil` so the model's own closure is preserved. The props reassign only
    /// when they change. Drives the open / close transition and re-syncs the visible image.
    public func update(_ input: LightboxInput, onClose: (@MainActor () -> Void)? = nil) {
        if let onClose { self.onClose = onClose }
        if input != self.input { self.input = input }
        syncOpenState()
    }

    // MARK: Commands (web `onClose`)

    /// Dismisses the viewer — the web `onClose` fan-in (the backdrop tap, the close button, and Esc). Hands
    /// off to the caller-owned closure, which flips `open` false.
    public func close() {
        onClose()
    }

    // MARK: Navigation (web `goPrev` / `goNext` / `goFirst` / `goLast`)

    /// Moves to the previous image (web `goPrev`).
    public func goPrevious() {
        setIndex(LightboxProjector.previousIndex(index))
    }

    /// Moves to the next image (web `goNext`).
    public func goNext() {
        setIndex(LightboxProjector.nextIndex(index, total: total))
    }

    /// Jumps to the first image (web `goFirst`, Home key).
    public func goFirst() {
        setIndex(LightboxProjector.firstIndex())
    }

    /// Jumps to the last image (web `goLast`, End key).
    public func goLast() {
        setIndex(LightboxProjector.lastIndex(total: total))
    }

    // MARK: Zoom (web `zoomIn` / `zoomOut` / `zoomReset`)

    /// Zooms in one half-step, clamped to 5x (web `zoomIn`).
    public func zoomIn() {
        zoom = LightboxProjector.zoomedIn(zoom)
    }

    /// Zooms out one half-step, clamped to 1x; snapping back to 1x re-centres the pan (web `zoomOut`).
    public func zoomOut() {
        zoom = LightboxProjector.zoomedOut(zoom)
        if zoom == LightboxZoom.minimum { pan = .zero }
    }

    /// Resets the zoom + pan to the rest state (web `zoomReset`, `0` key).
    public func zoomReset() {
        zoom = LightboxZoom.minimum
        pan = .zero
    }

    // MARK: Pan (web drag-to-pan when zoomed)

    /// Applies a pan offset — ignored unless the image is magnified (web `if (zoom <= 1) return`).
    public func setPan(_ pan: LightboxPan) {
        guard LightboxProjector.isZoomed(zoom) else { return }
        self.pan = pan
    }

    // MARK: Image load (web `<img>` decode + retry)

    /// Re-loads the visible image (the error-state retry). Forces a reload even when the source is unchanged.
    public func retry() {
        loadingSource = nil
        syncImage()
    }

    /// Awaits the in-flight load — a test seam so the deterministic `StaticLightboxImageLoader` outcome can be
    /// asserted without polling.
    func awaitCurrentLoad() async {
        await loadTask?.value
    }

    // MARK: Transitions

    private func syncOpenState() {
        if isOpen, !wasOpen {
            wasOpen = true
            telemetry.viewOpened(surface: LightboxSurface.slug)
            performOpen()
        } else if !isOpen, wasOpen {
            wasOpen = false
            loadTask?.cancel()
            loadingSource = nil
        } else if isOpen {
            clampIndexIntoRange()
            syncImage()
        }
    }

    /// Applies the closed→open reset (web `wasOpenRef` effect): re-seed the index from `initialIndex`, reset
    /// the zoom + pan, and load the first image. `initialIndex` changes while already open are ignored.
    private func performOpen() {
        index = input.safeInitialIndex
        zoom = LightboxZoom.minimum
        pan = .zero
        loadingSource = nil
        syncImage()
    }

    /// Selects a new index (web `setIndex`), resetting the zoom + pan + load (web effect on `[index]`).
    private func setIndex(_ newIndex: Int) {
        let clamped = LightboxProjector.clampIndex(newIndex, total: total)
        guard clamped != index else { return }
        index = clamped
        zoom = LightboxZoom.minimum
        pan = .zero
        syncImage()
    }

    private func clampIndexIntoRange() {
        let clamped = LightboxProjector.clampIndex(index, total: total)
        if clamped != index {
            index = clamped
            zoom = LightboxZoom.minimum
            pan = .zero
        }
    }

    /// Loads the visible image's bytes if its source changed, and pre-warms the neighbours — the native peer
    /// of the web `<img src>` decode + the `new Image()` pre-warm effect. No-op while closed or empty.
    private func syncImage() {
        guard isOpen, let source = currentImage?.source else {
            loadingSource = nil
            loadTask?.cancel()
            return
        }
        guard source != loadingSource else { return }
        loadingSource = source
        loadPhase = .loading
        prewarmNeighbours()
        loadToken += 1
        let token = loadToken
        loadTask?.cancel()
        loadTask = Task { [loader] in
            let outcome = await loader.load(source)
            guard !Task.isCancelled else { return }
            self.applyOutcome(outcome, source: source, token: token)
        }
    }

    private func applyOutcome(_ outcome: LightboxImageOutcome, source: String, token: Int) {
        guard token == loadToken, isOpen, loadingSource == source else { return }
        switch outcome {
        case let .loaded(data): loadPhase = .loaded(data)
        case .failed: loadPhase = .failed
        }
    }

    private func prewarmNeighbours() {
        for neighbour in LightboxProjector.neighbourIndices(index: index, total: total) {
            loader.prewarm(input.images[neighbour].source)
        }
    }
}
