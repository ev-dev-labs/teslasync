//
//  ImportPreviewModal.Model.swift
//  TeslaSync — P4 modal / dialog · 0024 · ImportPreviewModal (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `ImportPreviewModal` is a local-state
//  component: it owns the active tab, the pasted JSON, the import URL, the parse-error string, and
//  the resolved `ImportValidation`; it runs `validateImportData` synchronously (no network — its only
//  data dependency is `useTranslation`) and lifts the result into a preview screen. The native model
//  reproduces that whole lifecycle here — the inputs + commands (validate / file / url / confirm /
//  back / reset), the derived preview projection (title, badges, widget rows, mini-grid), and the
//  P1/S11 `view.opened` event emitted once on first appearance, plus the web `initialJson`
//  auto-validate. The view never reads files or applies dashboards directly — those are seams.
//

import Foundation
import Observation

/// The surface's observable view-model. Owns the import inputs + the resolved validation, exposes
/// the derived preview projection, and drives the confirm seam. Pure-local: the only side effect is
/// handing a validated dashboard to the injected ``ImportPreviewConfirmAction``.
@MainActor
@Observable
public final class ImportPreviewModalModel {
    // Inputs (web `activeTab` / `pastedJson` / `importUrl`)
    public private(set) var activeTab: ImportPreviewTab = .file
    public var pastedJSON = ""
    public var importURL = ""

    // Resolved state (web `validation` / `parseError`)
    public private(set) var validation: ImportPreviewValidation?
    public private(set) var parseError: String?

    @ObservationIgnored let catalog: any ImportPreviewWidgetCatalog
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private let telemetry: any ImportPreviewModalTelemetry
    @ObservationIgnored private let confirmAction: any ImportPreviewConfirmAction
    @ObservationIgnored private let initialJSON: String?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoValidate = false

    public init(
        initialJSON: String? = nil,
        catalog: any ImportPreviewWidgetCatalog = DefaultImportPreviewWidgetCatalog(),
        telemetry: any ImportPreviewModalTelemetry = OSLogImportPreviewModalTelemetry(),
        confirmAction: any ImportPreviewConfirmAction = OSLogImportPreviewConfirmAction(),
        localize: @escaping (String, String) -> String = ImportPreviewStrings.string
    ) {
        self.initialJSON = initialJSON
        self.catalog = catalog
        self.telemetry = telemetry
        self.confirmAction = confirmAction
        self.localize = localize
    }

    // MARK: Derived — screen + chrome

    /// Whether the preview screen is showing (web `if (validation) return <preview>`).
    public var isPreview: Bool {
        validation != nil
    }

    /// The modal header title (web `import.preview` vs `import.title`).
    public var title: String {
        ImportPreviewProjection.title(isPreview: isPreview, localize: localize)
    }

    /// The three import-source tabs (web `tabs`).
    public var tabs: [ImportPreviewTab] {
        ImportPreviewTab.allCases
    }

    /// The localized label for a tab (web `t(tab.label)`).
    public func tabLabel(_ tab: ImportPreviewTab) -> String {
        localize(tab.labelKey, tab.labelFallback)
    }

    /// Whether the Paste tab's Validate button is enabled (web `disabled={!pastedJson.trim()}`).
    public var canValidatePaste: Bool {
        !pastedJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Whether the URL tab's Load button is enabled (web `disabled={!importUrl.trim()}`).
    public var canLoadURL: Bool {
        !importURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: Derived — preview projection

    /// The validation errors (web `errors`).
    public var errors: [String] {
        validation?.errors ?? []
    }

    /// The validation warnings (web `warnings`).
    public var warnings: [String] {
        validation?.warnings ?? []
    }

    /// The validated dashboard, if any (web `validation.dashboard`).
    public var dashboard: ImportPreviewDashboard? {
        validation?.dashboard
    }

    /// The count chips above the widget list (web `<Badge>`s).
    public var badges: [ImportPreviewBadge] {
        validation.map { ImportPreviewProjection.badges(for: $0, localize: localize) } ?? []
    }

    /// The widget-availability rows (web available + missing lists).
    public var widgetRows: [ImportPreviewWidgetRow] {
        validation.map { ImportPreviewProjection.widgetRows(for: $0, catalog: catalog) } ?? []
    }

    /// The mini-grid thumbnail geometry, or `nil` when there is no dashboard to preview.
    public var grid: ImportPreviewGrid? {
        dashboard.map { ImportPreviewProjection.grid(for: $0, catalog: catalog) }
    }

    /// Whether the Import action is shown + enabled (web `isValid && dashboard`).
    public var canConfirm: Bool {
        (validation?.isValid ?? false) && dashboard != nil
    }

    // MARK: Lifecycle

    /// Begins the surface: emits `view.opened` once and auto-validates any `initialJson` (web
    /// `open && initialJson && !didAutoValidate`). Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ImportPreviewModalSurface.slug)
        if let initialJSON, !didAutoValidate {
            didAutoValidate = true
            validation = runValidation(initialJSON)
        }
    }

    // MARK: Commands — input

    /// Switches the active import-source tab (web `onChange={setActiveTab}`).
    public func selectTab(_ tab: ImportPreviewTab) {
        activeTab = tab
    }

    /// Validates the pasted JSON (web `onClick={() => handleValidate(pastedJson)}`).
    public func validatePasted() {
        handleValidate(pastedJSON)
    }

    /// Validates the text read from a picked / dropped `.json` file (web `handleFileImport` →
    /// `file.text()` → `handleValidate`).
    public func importFileText(_ text: String) {
        handleValidate(text)
    }

    /// Surfaces the web `import.readError` branch when a picked file could not be read.
    public func reportFileReadError() {
        parseError = localize("import.readError", "Failed to read file")
    }

    /// Surfaces the web `import.invalidFileType` branch when a non-`.json` file is dropped.
    public func reportInvalidDropType() {
        parseError = localize("import.invalidFileType", "Please drop a .json file")
    }

    /// Extracts + decodes a share URL and validates the payload (web `handleUrlImport`).
    public func loadFromURL() {
        parseError = nil
        switch ImportPreviewURLDecoder.extract(importURL) {
        case let .json(json):
            handleValidate(json)
        case .noParam:
            parseError = localize("import.noImportParam", "URL does not contain an import parameter")
        case .invalidURL:
            parseError = localize("import.invalidUrl", "Invalid URL format")
        }
    }

    // MARK: Commands — preview

    /// Returns to the input screen (web `handleBackToInput` — clears the validation + parse error).
    public func back() {
        validation = nil
        parseError = nil
    }

    /// Applies the validated dashboard through the confirm seam (web `handleConfirm` → `onConfirm`).
    /// Returns `true` when a dashboard was applied so the view can dismiss; a no-op otherwise.
    @discardableResult
    public func confirm() -> Bool {
        guard let dashboard else { return false }
        confirmAction.confirm(dashboard)
        reset()
        return true
    }

    /// Resets all local state (web `resetState`, run by `handleClose`).
    public func reset() {
        validation = nil
        parseError = nil
        pastedJSON = ""
        importURL = ""
        activeTab = .file
    }

    // MARK: Internals

    /// Web `handleValidate`: blank input surfaces `import.emptyInput`; otherwise run the validator.
    private func handleValidate(_ raw: String) {
        parseError = nil
        guard !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            parseError = localize("import.emptyInput", "No data to validate")
            return
        }
        validation = runValidation(raw)
    }

    private func runValidation(_ raw: String) -> ImportPreviewValidation {
        ImportPreviewValidator.validate(raw, registryIDs: catalog.registryIDs, localize: localize)
    }
}
