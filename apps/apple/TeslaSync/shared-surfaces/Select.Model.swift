//
//  Select.Model.swift
//  TeslaSync — P4 shared surface · 0225 · Select (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  form select. The web `<Select>` is purely presentational: it takes its data as plain props and renders a
//  controlled native `<select>` (`value` / `onChange`), with no fetcher — so the native peer needs no data
//  state-holder. What the holder DOES own is the surface's interaction state (the current `selection` — the
//  native peer of the web controlled `value`), the props (the derived ``SelectProjection`` is an observed
//  read), the `onChange` callback, and the single `view.opened` diagnostics event. No networking lives here.
//
//  The web source resolves NONE of its own copy — `label` / `error` / `hint` / `prompt` arrive already
//  localized, `form.required` is delegated to `<Label>`, and the help keys to `<HelpIcon>`. The facade below
//  therefore adds only the native a11y leaves the SwiftUI control needs: the empty-options copy, the spoken
//  name for an untitled control, and the "required" suffix (the native peer of `aria-required`, which on the
//  web is read off the paired `<Label>` association rather than a key).
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "Select" table, folded into the app `Localizable.xcstrings` catalog at integration
/// time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping the labels
/// deterministic. These are the surface's only owned strings — native a11y additions, since the web source
/// resolves no copy of its own.
public enum SelectStrings {
    public static let table = "Select"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The P1/S10 facade as a `SelectResolve` closure — the default resolver the holder uses. Tests inject an
    /// identity / fake resolver instead.
    public static let resolve: SelectResolve = { key, fallback in
        string(key, fallback)
    }

    /// Shown when no options resolve, so the surface never renders a bare box (native HIG; the web renders an
    /// empty `<select>`).
    public static var empty: String {
        string("select.empty", "No options available")
    }

    /// The spoken name for a control with no visible label, so VoiceOver never announces an anonymous picker.
    public static var untitled: String {
        string("select.untitled", "Select")
    }

    /// The screen-reader "required" suffix — the native peer of the web `aria-required` (read off the paired
    /// `<Label>` on the web; folded into the control's accessible name here so it survives a label-less field).
    public static var required: String {
        string("select.required", "required")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol SelectTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogSelectTelemetry: SelectTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - SelectModel (P1/S8) — interaction state + derivation

/// The surface's observable state-holder. It owns the current ``SelectInput`` (the web props) + the
/// `selection` (the native peer of the web controlled `value`), derives the pure ``SelectProjection`` as an
/// observed read (SwiftUI observation replaces the React re-render, resolving the localized a11y copy through
/// the P1/S10 facade), forwards selection changes to the `onChange` callback (web `onChange`), and emits
/// `view.opened` exactly once per instance. The web component has no fetcher, so neither does this holder.
@MainActor
@Observable
public final class SelectModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: SelectInput

    /// The current selected option value (web controlled `value`); `""` is the unselected / prompt state.
    /// Settable so the view can bind it to the `Picker` / `Menu`.
    public var selection: String

    @ObservationIgnored private let resolver: SelectResolve
    @ObservationIgnored private let onChange: (@MainActor (String) -> Void)?
    @ObservationIgnored private let telemetry: any SelectTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: SelectInput,
        selection: String = "",
        resolve: @escaping SelectResolve = SelectStrings.resolve,
        onChange: (@MainActor (String) -> Void)? = nil,
        telemetry: any SelectTelemetry = OSLogSelectTelemetry()
    ) {
        self.input = input
        self.selection = selection
        resolver = resolve
        self.onChange = onChange
        self.telemetry = telemetry
    }

    /// The resolved, view-ready select (web render output) — a pure function of the props + the injected
    /// resolver.
    public var projection: SelectProjection {
        SelectProjector.resolve(
            input: input,
            emptyText: resolver("select.empty", "No options available"),
            untitled: resolver("select.untitled", "Select"),
            requiredWord: resolver("select.required", "required")
        )
    }

    /// The currently selected option, if the selection matches one (web `options.find(o => o.value === value)`).
    public var selectedOption: SelectOptionInput? {
        input.options.first { $0.value == selection }
    }

    /// The trigger's display title — the selected option's label, else the prompt, else the first option, else
    /// the untitled fallback. A pure derivation exposed for the view + tests.
    public var displayTitle: String {
        SelectProjector.displayTitle(
            options: input.options,
            selection: selection,
            prompt: input.prompt,
            untitled: resolver("select.untitled", "Select")
        )
    }

    /// Whether the trigger is showing the unselected prompt (no option matches + a prompt exists) — used by
    /// the view to mute the trigger text, the native peer of an unselected `<select>` showing its prompt copy.
    public var isShowingPrompt: Bool {
        selectedOption == nil && SelectProjector.isPresent(input.prompt)
    }

    /// Selects an option value — the native peer of the web `onChange`. Ignores a value that maps to a
    /// disabled option (the web `<option disabled>` cannot be chosen); the prompt value `""` is always
    /// allowed (web `<option value="">`). Reassigns + forwards only on an actual change.
    public func select(_ value: String) {
        if let match = input.options.first(where: { $0.value == value }), match.isDisabled {
            return
        }
        guard value != selection else { return }
        selection = value
        onChange?(value)
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// input actually changes so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: SelectInput) {
        guard input != self.input else { return }
        self.input = input
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear churn —
    /// the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: SelectSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
