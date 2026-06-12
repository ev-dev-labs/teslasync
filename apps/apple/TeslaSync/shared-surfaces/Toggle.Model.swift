//
//  Toggle.Model.swift
//  TeslaSync — P4 shared surface · 0230 · Toggle (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  switch toggle. The view binds through `ToggleModel`; no networking lives in the view (the web
//  source has none — it is a controlled primitive reading its `checked` prop + `useId`). The model
//  owns the canonical on / off state, exposes the resolved projection the view renders, commits
//  changes back through the caller's `onChange` (the web `onChange(!checked)`), adopts new props when
//  the host re-renders (`sync(_:)`, the parity of a controlled re-render), and emits the `view.opened`
//  diagnostics event exactly once when the surface first appears. The surface always presents the
//  switch (there is no pre-content loading gate because the source has no fetch), so the first
//  appearance is the open moment.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ToggleTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogToggleTelemetry: ToggleTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the views and the adapter hold
/// no hardcoded user-facing literals. The web `Toggle` renders no translatable copy of its own (the
/// `label` is caller-supplied); the only native-owned string is the unlabeled-switch fallback name,
/// reproduced here. Keys live in the "Toggle" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum ToggleStrings {
    public static let table = "Toggle"

    public static let string: ToggleResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Holds the canonical on / off state + the resolved projection
/// the view renders, commits changes back through the caller's `onChange` (the web `onChange(next)`),
/// adopts new props via `sync(_:)` (the parity of a controlled re-render with a changed `checked` /
/// `label` / `size`), and emits the `view.opened` diagnostics event exactly once when the surface
/// first appears. There is no async source because the web source has no data dependency; the host
/// owns the state and feeds it on every render.
@MainActor
@Observable
public final class ToggleModel {
    /// The canonical on / off state the native switch binds to.
    public private(set) var isOn: Bool
    /// The resolved, view-ready projection.
    public private(set) var resolved: ToggleResolved

    @ObservationIgnored private var input: ToggleInput
    @ObservationIgnored private let onChange: (Bool) -> Void
    @ObservationIgnored private let telemetry: any ToggleTelemetry
    @ObservationIgnored private let strings: ToggleResolve
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: ToggleInput,
        onChange: @escaping (Bool) -> Void = { _ in },
        telemetry: any ToggleTelemetry = OSLogToggleTelemetry(),
        strings: @escaping ToggleResolve = ToggleStrings.string
    ) {
        self.input = input
        self.onChange = onChange
        self.telemetry = telemetry
        self.strings = strings
        isOn = input.isOn
        resolved = ToggleProjection.resolve(input, strings: strings)
    }

    /// Records the surface open exactly once. Idempotent across re-appears; the surface always
    /// presents the switch, so the first appearance is the open moment.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: ToggleMeta.surfaceSlug)
    }

    /// Symmetry with `start()` for the view lifecycle; the surface holds no resources to release.
    public func stop() {}

    /// Commit a new state — the web `onChange(next)` path. When it differs from the current state,
    /// adopts it, recomputes the projection, and forwards it to the host. Idempotent for an unchanged
    /// state, so the controlled re-render it triggers does not loop.
    public func setOn(_ next: Bool) {
        guard next != isOn else { return }
        isOn = next
        input.isOn = next
        resolved = ToggleProjection.resolve(input, strings: strings)
        onChange(next)
    }

    /// Flip the state — the web `onChange(!checked)` invoked from the switch / the label tap.
    public func toggle() {
        setOn(!isOn)
    }

    /// Adopt a new input snapshot — the parity of a controlled re-render with a changed `checked` /
    /// `label` / `size`. Recomputes the canonical state + projection; idempotent for an unchanged
    /// snapshot.
    public func sync(_ newInput: ToggleInput) {
        guard newInput != input else { return }
        input = newInput
        isOn = newInput.isOn
        resolved = ToggleProjection.resolve(newInput, strings: strings)
    }
}
