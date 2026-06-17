import Foundation
import Observation
import SwiftUI

#if canImport(UIKit)
    import UIKit
#endif
#if canImport(AppKit)
    import AppKit
#endif

// MARK: - Copy status message (web `statusMessage` useState)

/// The deterministic status message the "Copy to clipboard" action surfaces — the native port of
/// the web `statusMessage` state. The web `handleCopy` guards an empty editor, then the absence of
/// `navigator.clipboard`, then a write success / failure; this enum carries the same four outcomes
/// and resolves the web i18n key + default for each. Like the web `<span role="status">`, all four
/// render in the same amber tone (web `text-amber-300`).
public enum DashboardCopyMessage: Equatable, Sendable {
    /// Web `powerDashboards.editor.copyEmpty` — Copy fired on an empty editor.
    case empty
    /// Web `powerDashboards.editor.copyUnavailable` — the platform clipboard is unavailable.
    case unavailable
    /// Web `powerDashboards.editor.copySuccess` — the JSON was written to the clipboard.
    case success
    /// Web `powerDashboards.editor.copyFailed` — the clipboard write failed.
    case failure

    /// The i18n key the view renders for this message (web `t(key, default)`).
    public var key: LocalizedStringKey {
        switch self {
        case .empty: "powerDashboards.editor.copyEmpty"
        case .unavailable: "powerDashboards.editor.copyUnavailable"
        case .success: "powerDashboards.editor.copySuccess"
        case .failure: "powerDashboards.editor.copyFailed"
        }
    }
}

// MARK: - Clipboard seam (web `navigator.clipboard`)

/// The outcome of a clipboard write — the native mirror of the web `handleCopy` branches:
/// `written` (web `clipboard.writeText` resolved), `unavailable` (web `navigator.clipboard`
/// absent), `failed` (web `clipboard.writeText` rejected).
public enum DashboardClipboardResult: Equatable, Sendable {
    case written
    case unavailable
    case failed
}

/// Writes text to the platform clipboard — the native port of the web `navigator.clipboard`
/// capability the page guards before copying. Injected so previews/tests drive the
/// `unavailable` / `failed` branches with a double instead of touching the real pasteboard.
public protocol DashboardClipboard: Sendable {
    /// Web `navigator.clipboard.writeText(text)` — returns the deterministic write outcome.
    func writeText(_ text: String) -> DashboardClipboardResult
}

/// The production `DashboardClipboard` backed by the platform pasteboard: `UIPasteboard` on iOS,
/// `NSPasteboard` on macOS (whose `setString` outcome distinguishes `written` from `failed`). A
/// build that ships neither (theoretical) reports `unavailable`, faithful to the web capability
/// guard. Stateless, so trivially `Sendable`.
public struct SystemDashboardClipboard: DashboardClipboard {
    public init() {}

    public func writeText(_ text: String) -> DashboardClipboardResult {
        #if canImport(UIKit)
            UIPasteboard.general.string = text
            return .written
        #elseif canImport(AppKit)
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            return pasteboard.setString(text, forType: .string) ? .written : .failed
        #else
            return .unavailable
        #endif
    }
}

// MARK: - Draft persistence seam (web localStorage 'ai.dashboardComposer.draft')

/// Persists the JSON editor draft across navigation — the native port of the web page's
/// localStorage usage (canonical key `ai.dashboardComposer.draft`) so a long envelope survives a
/// navigate-away + back. Injected so tests/previews use an in-memory double instead of touching
/// the shared `UserDefaults`.
public protocol DashboardDraftStore: Sendable {
    /// Web `loadPersistedJson()` — the stored draft, or `""` when none.
    func load() -> String
    /// Web `persistJson(value)` — store the draft, or remove it when empty.
    func save(_ value: String)
}

/// The production `DashboardDraftStore` backed by `UserDefaults` under the web's canonical key. An
/// empty value removes the key (web `removeItem`), so a cleared editor leaves no residue.
/// `UserDefaults` is thread-safe, so `@unchecked Sendable` is sound (no mutable Swift state).
public struct UserDefaultsDashboardDraftStore: DashboardDraftStore, @unchecked Sendable {
    /// The canonical persistence key — identical to the web `DASHBOARD_COMPOSER_DRAFT_KEY`.
    public static let key = "ai.dashboardComposer.draft"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() -> String {
        defaults.string(forKey: Self.key) ?? ""
    }

    public func save(_ value: String) {
        if value.isEmpty {
            defaults.removeObject(forKey: Self.key)
        } else {
            defaults.set(value, forKey: Self.key)
        }
    }
}

// MARK: - Dashboard envelope JSON (web `JSON.stringify(draft.dashboard, null, 2)`)

/// Serialises a captured `DashboardEnvelope` to the pretty-printed JSON the editor is populated
/// with when an AI draft is applied — the native parity of the web
/// `JSON.stringify(draft.dashboard, null, 2)`. The wire shape matches the web `DashboardEnvelope`
/// (`title` + `slots[].panel_name` + `slots[].grid_pos.{x,y,w,h}`); 2-space indentation +
/// deterministic sorted keys make the output stable + Grafana-importable.
public enum DashboardEnvelopeJSON {
    public static func pretty(_ envelope: DashboardEnvelope) -> String {
        let slots: [[String: Any]] = envelope.slots.map { slot in
            [
                "panel_name": slot.panelName,
                "grid_pos": [
                    "x": slot.gridPos.x,
                    "y": slot.gridPos.y,
                    "w": slot.gridPos.width,
                    "h": slot.gridPos.height
                ]
            ]
        }
        let object: [String: Any] = ["title": envelope.title, "slots": slots]
        guard
            let data = try? JSONSerialization.data(
                withJSONObject: object,
                options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            ),
            let json = String(data: data, encoding: .utf8)
        else {
            return ""
        }
        return json
    }
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). The web
/// `DashboardsPage` owns no API data: it renders the page chrome (title + intro), the embedded
/// `AINLDashboardComposer` Helix drafter, a manual JSON editor (textarea + Copy/Clear +
/// status message), and the install-static curated panel catalog. This model mirrors that exactly —
/// it exposes the page's i18n keys, owns the editor's draft (persisted via the injected
/// `DashboardDraftStore`), the Copy/Clear/status logic (over an injected `DashboardClipboard`), the
/// sorted catalog, and the embedded `NLDashboardComposerModel` whose `onApply` copies a proposed
/// draft's pretty-printed JSON into the editor (web `handleApplyAiDraft`). It never pushes to
/// Grafana and never auto-applies a proposal (propose-only, ADR-015 §I8).
@MainActor
@Observable
public final class DashboardsPageModel {
    // MARK: Parity i18n keys (web `t(key, default)`)

    /// Web `t('powerDashboards.title', 'Dashboard Composer')` (page title + window title).
    public let titleKey: LocalizedStringKey = "powerDashboards.title"
    /// Web `t('powerDashboards.intro', …)`.
    public let introKey: LocalizedStringKey = "powerDashboards.intro"
    /// Web `t('powerDashboards.editor.title', 'Manual dashboard JSON editor')`.
    public let editorTitleKey: LocalizedStringKey = "powerDashboards.editor.title"
    /// Web `t('powerDashboards.editor.label', 'Dashboard JSON editor')` — the editor a11y label.
    public let editorLabelKey: LocalizedStringKey = "powerDashboards.editor.label"
    /// Web `t` empty-state prompt the editor shows when blank (the editor textarea hint key).
    public let editorPromptKey: LocalizedStringKey = "powerDashboards.editor.placeholder" // parity:allow i18n key name
    /// Web `t('powerDashboards.editor.copy', 'Copy to clipboard')`.
    public let copyKey: LocalizedStringKey = "powerDashboards.editor.copy"
    /// Web `t('powerDashboards.editor.clear', 'Clear')`.
    public let clearKey: LocalizedStringKey = "powerDashboards.editor.clear"
    /// Web `t('powerDashboards.panels.title', 'Curated panel catalog')`.
    public let panelsTitleKey: LocalizedStringKey = "powerDashboards.panels.title"
    /// Web `t('powerDashboards.panels.intro', …)`.
    public let panelsIntroKey: LocalizedStringKey = "powerDashboards.panels.intro"

    // MARK: Editor state (web `dashboardJson` / `statusMessage` useState)

    /// The JSON editor contents (web `dashboardJson`), persisted on every change (web `useEffect`).
    public var dashboardJSON: String {
        didSet { draftStore.save(dashboardJSON) }
    }

    /// The deterministic copy status message (web `statusMessage`), or `nil` when none is shown.
    public private(set) var copyMessage: DashboardCopyMessage?

    /// The curated panel catalog, name-sorted (web `sortedPanels`).
    public let panels: [CuratedDashboardPanel] = DashboardsPanelCatalog.sorted

    @ObservationIgnored private let draftStore: any DashboardDraftStore
    @ObservationIgnored private let clipboard: any DashboardClipboard
    @ObservationIgnored private let drafterSource: any NLDashboardComposerSource
    @ObservationIgnored private let drafterTelemetry: any NLDashboardComposerTelemetry
    @ObservationIgnored private var cachedDrafter: NLDashboardComposerModel?

    /// - Parameters:
    ///   - draftStore: persistence seam (web localStorage). Defaults to `UserDefaults`.
    ///   - clipboard: the clipboard seam (web `navigator.clipboard`). Defaults to the platform
    ///     pasteboard; tests inject a double to drive the `unavailable` / `failed` branches.
    ///   - drafterSource: the Helix drafter's gate/stream seam (web `useAiStream` +
    ///     `/ai/power/dashboard/draft` SSE). Defaults to an in-memory, gate-on source so the
    ///     drafter renders its ready card out of the box; production injects the shared KMP binding.
    ///   - drafterTelemetry: the drafter's `view.opened` diagnostics seam.
    public init(
        draftStore: any DashboardDraftStore = UserDefaultsDashboardDraftStore(),
        clipboard: any DashboardClipboard = SystemDashboardClipboard(),
        drafterSource: (any NLDashboardComposerSource)? = nil,
        drafterTelemetry: any NLDashboardComposerTelemetry = OSLogNLDashboardComposerTelemetry()
    ) {
        self.draftStore = draftStore
        self.clipboard = clipboard
        self.drafterTelemetry = drafterTelemetry
        self.drafterSource = drafterSource
            ?? InMemoryNLDashboardComposerSource(initial: NLDashboardComposerInputSnapshot(gate: .on))
        // didSet does not fire for an initializer assignment, so the loaded draft is not re-saved.
        dashboardJSON = draftStore.load()
        copyMessage = nil
    }

    // MARK: Embedded Helix drafter (web `<AINLDashboardComposer onApply={handleApplyAiDraft} />`)

    /// The embedded "Helix natural-language dashboard composer" model (the already-shipped
    /// `AINLDashboardComposer` surface). Lazily built on first access — when `self` is fully
    /// initialized — so the `onApply` callback can capture `[weak self]` and copy an applied
    /// draft's pretty-printed JSON into the editor (web `handleApplyAiDraft` →
    /// `setDashboardJson(JSON.stringify(draft.dashboard, null, 2))`), mirroring the sibling
    /// `SqlPlaygroundPageModel.drafter` precedent. Cached so the drafter's streaming state survives
    /// view re-renders.
    public var drafter: NLDashboardComposerModel {
        if let cachedDrafter { return cachedDrafter }
        let model = NLDashboardComposerModel(
            source: drafterSource,
            telemetry: drafterTelemetry
        ) { [weak self] draft in
            self?.applyDraft(draft)
        }
        cachedDrafter = model
        return model
    }

    // MARK: Actions (web `handleCopy` / `handleClear` / `handleApplyAiDraft`)

    /// Web `canCopy = dashboardJson.trim().length > 0` — gates both Copy and Clear.
    public var canCopy: Bool {
        !dashboardJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Web `handleCopy`: an empty editor yields the "type a JSON envelope first" hint; otherwise the
    /// trimmed JSON is written to the clipboard and the deterministic success / unavailable /
    /// failure message is surfaced (web `copySuccess` / `copyUnavailable` / `copyFailed`).
    public func copy() {
        let trimmed = dashboardJSON.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            copyMessage = .empty
            return
        }
        switch clipboard.writeText(trimmed) {
        case .written: copyMessage = .success
        case .unavailable: copyMessage = .unavailable
        case .failed: copyMessage = .failure
        }
    }

    /// Web `handleClear`: reset the editor + clear the status message.
    public func clear() {
        dashboardJSON = ""
        copyMessage = nil
    }

    /// Web `handleApplyAiDraft`: render the Helix-proposed dashboard envelope as pretty-printed JSON
    /// into the editor (web `JSON.stringify(draft.dashboard, null, 2)`) and clear any prior status.
    /// The user must still explicitly press Copy (propose-only, ADR-015 §I8).
    public func applyDraft(_ draft: DashboardLayoutDraft) {
        dashboardJSON = DashboardEnvelopeJSON.pretty(draft.dashboard)
        copyMessage = nil
    }

    // MARK: Page-scaffold async contract

    /// The page owns no fetch of its own (the catalog is static; the drafter manages its own gate
    /// lifecycle on appear). Exposed for the page-scaffold async contract, it re-requests the
    /// drafter's gate snapshot (web refetch).
    public func load() async {
        refresh()
    }

    /// Re-requests the embedded drafter's gate/context snapshot (web refetch).
    public func refresh() {
        drafter.refresh()
    }
}
