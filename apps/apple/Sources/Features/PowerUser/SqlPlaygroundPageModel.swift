import Foundation
import Observation
import SwiftUI

// MARK: - Run message (web `runMessage` useState)

/// The deterministic message the "Run" action surfaces — the native port of the web
/// `runMessage` state. This page exposes NO SQL execution endpoint (web source note): an empty
/// editor yields the "type a query first" hint, and a non-empty editor yields the "copy into a
/// read-only DB client" instruction. A future typed read-only execution endpoint can replace the
/// `unavailable` branch without changing this page's structure.
public enum SqlRunMessage: Equatable, Sendable {
    /// Web `powerSql.editor.runEmpty` — shown when Run fires on an empty editor.
    case empty
    /// Web `powerSql.editor.runUnavailable` — browser/app read-only execution is not enabled.
    case unavailable

    /// The i18n key the view renders for this message (web `t(key, default)`).
    public var key: LocalizedStringKey {
        switch self {
        case .empty: "powerSql.editor.runEmpty"
        case .unavailable: "powerSql.editor.runUnavailable"
        }
    }
}

// MARK: - Draft persistence seam (web localStorage 'ai.sqlPlayground.draft')

/// Persists the SQL editor draft across navigation — the native port of the web page's
/// localStorage usage (canonical key `ai.sqlPlayground.draft`) so a long query survives a
/// navigate-away + back. Injected so tests/previews use an in-memory double instead of touching
/// the shared `UserDefaults`.
public protocol SqlDraftStore: Sendable {
    /// Web `loadPersistedSql()` — the stored draft, or `""` when none.
    func load() -> String
    /// Web `persistSql(value)` — store the draft, or remove it when empty.
    func save(_ value: String)
}

/// The production `SqlDraftStore` backed by `UserDefaults` under the web's canonical key. An empty
/// value removes the key (web `removeItem`), so a cleared editor leaves no residue. `UserDefaults`
/// is thread-safe, so `@unchecked Sendable` is sound (no mutable Swift state).
public struct UserDefaultsSqlDraftStore: SqlDraftStore, @unchecked Sendable {
    /// The canonical persistence key — identical to the web `SQL_PLAYGROUND_DRAFT_KEY`.
    public static let key = "ai.sqlPlayground.draft"

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

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). The web
/// `SqlPlaygroundPage` owns no API data: it renders the page chrome (title + intro), the embedded
/// `AINLSqlPlayground` Helix drafter, a deterministic manual SQL editor (textarea + Run/Clear +
/// run-message), and the install-static curated schema catalog. This model mirrors that exactly —
/// it exposes the page's i18n keys, owns the editor's draft (persisted via the injected
/// `SqlDraftStore`), the Run/Clear/run-message logic, the sorted catalog, and the embedded
/// `NLSqlPlaygroundModel` whose `onApply` is wired to copy a proposed draft into the editor (web
/// `handleApplyAiDraft`). It never executes SQL and never auto-applies a proposal (propose-only,
/// ADR-015 §I8).
@MainActor
@Observable
public final class SqlPlaygroundPageModel {
    // MARK: Parity i18n keys (web `t(key, default)`)

    /// Web `t('powerSql.title', 'SQL Playground')` (page title + window title).
    public let titleKey: LocalizedStringKey = "powerSql.title"
    /// Web `t('powerSql.intro', …)`.
    public let introKey: LocalizedStringKey = "powerSql.intro"
    /// Web `t('powerSql.editor.title', 'Manual SQL editor')`.
    public let editorTitleKey: LocalizedStringKey = "powerSql.editor.title"
    /// Web `t('powerSql.editor.label', 'SQL query editor')` — the editor's accessibility label.
    public let editorLabelKey: LocalizedStringKey = "powerSql.editor.label"
    /// Web `t` empty-state prompt text the editor shows when blank (the editor textarea hint key).
    public let editorPromptKey: LocalizedStringKey = "powerSql.editor.placeholder" // parity:allow i18n key name
    /// Web `t('powerSql.editor.run', 'Run')`.
    public let runKey: LocalizedStringKey = "powerSql.editor.run"
    /// Web `t('powerSql.editor.clear', 'Clear')`.
    public let clearKey: LocalizedStringKey = "powerSql.editor.clear"
    /// Web `t('powerSql.catalog.title', 'Curated schema catalog')`.
    public let catalogTitleKey: LocalizedStringKey = "powerSql.catalog.title"
    /// Web `t('powerSql.catalog.intro', …)`.
    public let catalogIntroKey: LocalizedStringKey = "powerSql.catalog.intro"

    // MARK: Editor state (web `sql` / `runMessage` useState)

    /// The SQL editor contents (web `sql`), persisted on every change (web `useEffect`).
    public var sql: String {
        didSet { draftStore.save(sql) }
    }

    /// The deterministic Run message (web `runMessage`), or `nil` when none is shown.
    public private(set) var runMessage: SqlRunMessage?

    /// The curated schema catalog, name-sorted (web `sortedTables`).
    public let tables: [SqlCatalogTable] = SqlPlaygroundCatalog.sorted

    @ObservationIgnored private let draftStore: any SqlDraftStore
    @ObservationIgnored private let drafterSource: any NLSqlPlaygroundSource
    @ObservationIgnored private let drafterTelemetry: any NLSqlPlaygroundTelemetry
    @ObservationIgnored private var cachedDrafter: NLSqlPlaygroundModel?

    /// - Parameters:
    ///   - draftStore: persistence seam (web localStorage). Defaults to `UserDefaults`.
    ///   - drafterSource: the Helix drafter's gate/stream seam (web `useAiEnabled` +
    ///     `/ai/power/sql/draft` SSE). Defaults to an in-memory, gate-on source so the drafter
    ///     renders its ready card out of the box; production injects the shared KMP binding.
    ///   - drafterTelemetry: the drafter's `view.opened` diagnostics seam.
    public init(
        draftStore: any SqlDraftStore = UserDefaultsSqlDraftStore(),
        drafterSource: (any NLSqlPlaygroundSource)? = nil,
        drafterTelemetry: any NLSqlPlaygroundTelemetry = OSLogNLSqlPlaygroundTelemetry()
    ) {
        self.draftStore = draftStore
        self.drafterTelemetry = drafterTelemetry
        self.drafterSource = drafterSource
            ?? InMemoryNLSqlPlaygroundSource(initial: NLSqlPlaygroundInputSnapshot(gate: .on))
        // didSet does not fire for an initializer assignment, so the loaded draft is not re-saved.
        sql = draftStore.load()
        runMessage = nil
    }

    // MARK: Embedded Helix drafter (web `<AINLSqlPlayground onApply={handleApplyAiDraft} />`)

    /// The embedded "Helix natural-language SQL drafter" model (the already-shipped
    /// `AINLSqlPlayground` surface). Lazily built on first access — when `self` is fully
    /// initialized — so the `onApply` callback can capture `[weak self]` and copy an applied draft
    /// into the editor (web `handleApplyAiDraft` → `setSql(draft.sql)`), mirroring the sibling
    /// `LocationsPageModel.nameDraftModel(for:)` precedent. Cached so the drafter's streaming state
    /// survives view re-renders.
    public var drafter: NLSqlPlaygroundModel {
        if let cachedDrafter { return cachedDrafter }
        let model = NLSqlPlaygroundModel(source: drafterSource, telemetry: drafterTelemetry) { [weak self] draft in
            self?.applyDraft(draft)
        }
        cachedDrafter = model
        return model
    }

    // MARK: Actions (web `handleRun` / `handleClear` / `handleApplyAiDraft`)

    /// Web `canRun = sql.trim().length > 0` — gates both Run and Clear.
    public var canRun: Bool {
        !sql.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Web `handleRun`: an empty editor yields the "type a query first" hint; a non-empty editor
    /// yields the deterministic "copy into a read-only DB client" instruction (this page exposes no
    /// SQL execution endpoint).
    public func run() {
        runMessage = canRun ? .unavailable : .empty
    }

    /// Web `handleClear`: reset the editor + clear the run message.
    public func clear() {
        sql = ""
        runMessage = nil
    }

    /// Web `handleApplyAiDraft`: copy the Helix-proposed draft into the editor and clear any prior
    /// run message. The user must still explicitly press Run (propose-only, ADR-015 §I8).
    public func applyDraft(_ draft: ReadonlySQLDraft) {
        sql = draft.sql
        runMessage = nil
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
