//
//  AIProviderSection.Model.swift
//  TeslaSync — P4 feature view · 0200 · AIProviderSection (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the AI provider configuration surface — the SwiftUI parity of
//  features/settings/components/AIProviderSection.tsx. The web component is a
//  controlled form driven by parent-owned `value`/`isCloud`/`onChange` plus the
//  `useValidateAiProvider` mutation; this model folds those into one editable draft,
//  a commit seam (web `onChange`), and an async validate seam (web
//  `validate.mutateAsync`). No networking lives in the view.
//

import Foundation
import Observation
import OSLog

// MARK: - Editable draft (web `AIProviderDraft`)

/// The in-memory provider form — the native mirror of the web `AIProviderDraft`. All
/// fields carry the wire (SI/snake_case) semantics; `apiKey` lives in memory only and
/// an empty value means "no change on save". `costCapCents` is whole cents.
public struct AiProviderDraft: Sendable, Equatable {
    public var provider: String
    public var baseURL: String
    public var model: String
    public var apiKey: String
    public var costCapCents: Int
    public var apiVersion: String
    public var flavor: String
    public var deployment: String
    public var embeddingModel: String
    public var embeddingDeployment: String

    public init(
        provider: String = "openai",
        baseURL: String = "",
        model: String = "",
        apiKey: String = "",
        costCapCents: Int = 0,
        apiVersion: String = "",
        flavor: String = "",
        deployment: String = "",
        embeddingModel: String = "",
        embeddingDeployment: String = ""
    ) {
        self.provider = provider
        self.baseURL = baseURL
        self.model = model
        self.apiKey = apiKey
        self.costCapCents = costCapCents
        self.apiVersion = apiVersion
        self.flavor = flavor
        self.deployment = deployment
        self.embeddingModel = embeddingModel
        self.embeddingDeployment = embeddingDeployment
    }

    /// The neutral seed used before any payload resolves (empty branch / pre-hydrate).
    public static let empty = AiProviderDraft()
}

// MARK: - Connectivity + validate lifecycle (P4 leaf axes)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum AiProviderConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

/// The validate-probe lifecycle — the native mirror of the web `validate.isPending`
/// flag that drives the button label + disabled state.
public enum AiProviderValidatePhase: Sendable, Equatable {
    case idle
    case validating

    public var isValidating: Bool {
        self == .validating
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared
/// diagnostics sink (consent-gated + redacted there).
public protocol AiProviderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default recording the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogAiProviderTelemetry: AiProviderTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer; never HTTP from the view)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 AI settings state holder (provider config + mode) and the validate
/// mutation; previews and tests use `InMemoryAiProviderSource`. `commitDraft` is the
/// web `onChange`; `validate(_:)` is the web `validate.mutateAsync`.
@MainActor
public protocol AiProviderSource: AnyObject {
    var onUpdate: (@MainActor (AiProviderInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func commitDraft(_ draft: AiProviderDraft)
    func validate(_ request: AiProviderValidateRequest) async -> AiProviderValidateResult
}

// MARK: - View model

/// The surface's observable view-model. Subscribes to an `AiProviderSource`, exposes
/// the render `phase`, the editable `draft`, the `connection` axis, the validate
/// lifecycle + banner, and the field-visibility decisions (delegated to the pure
/// `AiProviderLayout`). Edits clear the validate banner and commit upstream (web
/// `patch`); a stale transition triggers a one-shot auto-refresh.
@MainActor
@Observable
public final class AiProviderModel {
    public private(set) var resolved: AiProviderResolved =
        AiProviderProjection.resolve(AiProviderInput(isLoading: true))
    public private(set) var connection: AiProviderConnection = .live
    public private(set) var validatePhase: AiProviderValidatePhase = .idle
    public private(set) var banner: AiProviderValidateBanner?

    /// The editable form (web controlled `value`). Every edit — through a `@Bindable`
    /// field binding or `patch` — clears the stale validate banner and commits the
    /// new draft upstream (web `onChange`), except during external hydration.
    public var draft: AiProviderDraft = .empty {
        didSet {
            guard !isApplyingExternal, draft != oldValue else { return }
            banner = nil
            source.commitDraft(draft)
        }
    }

    @ObservationIgnored private let source: any AiProviderSource
    @ObservationIgnored private let telemetry: any AiProviderTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didHydrate = false
    @ObservationIgnored private var isApplyingExternal = false

    public init(
        source: any AiProviderSource,
        telemetry: any AiProviderTelemetry = OSLogAiProviderTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    // MARK: Render-state passthrough

    public var phase: AiProviderResolved.Phase {
        resolved.phase
    }

    public var isCloud: Bool {
        resolved.isCloud
    }

    public var isValidating: Bool {
        validatePhase.isValidating
    }

    // MARK: Field-visibility (web conditional-render guards via AiProviderLayout)

    public var providerOptions: [AiProviderOption] {
        AiProviderCatalog.options(isCloud: isCloud)
    }

    public var modelUsesAzureIdentifier: Bool {
        AiProviderLayout.modelUsesAzureIdentifier(provider: draft.provider, flavor: draft.flavor)
    }

    public var showsAzureBlock: Bool {
        AiProviderLayout.showsAzureBlock(isCloud: isCloud, provider: draft.provider)
    }

    public var showsAzureDeployments: Bool {
        AiProviderLayout.showsAzureDeployments(flavor: draft.flavor)
    }

    public var showsLocalBaseURL: Bool {
        AiProviderLayout.showsLocalBaseURL(isCloud: isCloud)
    }

    public var showsAzureBaseURL: Bool {
        AiProviderLayout.showsAzureBaseURL(isCloud: isCloud, provider: draft.provider)
    }

    public var showsCloudFields: Bool {
        AiProviderLayout.showsCloudFields(isCloud: isCloud)
    }

    public var showsLocalExplainer: Bool {
        AiProviderLayout.showsLocalExplainer(isCloud: isCloud)
    }

    public var modelPrompt: String {
        AiProviderLayout.modelPrompt(isCloud: isCloud)
    }

    public var azureDeploymentPrompt: String {
        AiProviderLayout.azureDeploymentPrompt(model: draft.model)
    }

    public var azureEmbeddingPrompt: String {
        AiProviderLayout.azureEmbeddingPrompt(embeddingModel: draft.embeddingModel)
    }

    public var localValidateDisabled: Bool {
        AiProviderValidateGate.localDisabled(isValidating: isValidating, baseURL: draft.baseURL)
    }

    public var cloudValidateDisabled: Bool {
        AiProviderValidateGate.cloudDisabled(isValidating: isValidating)
    }

    // MARK: Derived bindings (computed so writes route through `patch`)

    /// The Azure flavor selection (web `value.flavor || 'openai'` default applied).
    public var azureFlavor: String {
        get { AiAzureFlavor.effective(draft.flavor) }
        set { patch { $0.flavor = newValue } }
    }

    /// The cost-cap field text (web cents↔dollars round-trip at the input boundary).
    public var costCapText: String {
        get { AiCostCapField.display(cents: draft.costCapCents) }
        set { patch { $0.costCapCents = AiCostCapField.cents(fromDollars: newValue) } }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AIProviderSection.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Applies an edit, clearing the stale banner + committing upstream via `draft`'s
    /// observer (web `patch` → `onChange` + `setValidateBanner(null)`).
    public func patch(_ transform: (inout AiProviderDraft) -> Void) {
        transform(&draft)
    }

    /// Runs the provider probe (web `runValidate`). Re-entrancy is guarded so a
    /// double-tap cannot fan out two requests; the banner reflects the outcome.
    public func runValidate() async {
        guard !validatePhase.isValidating else { return }
        banner = nil
        validatePhase = .validating
        let request = AiProviderValidateRequest.build(isCloud: isCloud, draft: draft)
        let result = await source.validate(request)
        banner = AiProviderValidateBannerFactory.make(from: result) { key, fallback in
            AiProviderStrings.string(key, fallback)
        }
        validatePhase = .idle
    }

    private func apply(_ input: AiProviderInput) {
        resolved = AiProviderProjection.resolve(input)
        // One-shot hydration: seed the editable draft from the first resolved payload
        // without echoing a commit, then preserve the user's in-flight edits.
        if !didHydrate, input.savedDraft != nil {
            didHydrate = true
            isApplyingExternal = true
            draft = resolved.draft
            isApplyingExternal = false
        }
        let previous = connection
        connection = input.connection
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - In-memory source (previews + tests; the view never performs I/O)

/// In-memory source for previews + unit tests. Seed it with an initial input and a
/// canned validate result, or drive it manually via `push(_:)` to script flows.
@MainActor
public final class InMemoryAiProviderSource: AiProviderSource {
    public var onUpdate: (@MainActor (AiProviderInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var commitCount = 0
    public private(set) var validateCount = 0
    public private(set) var lastCommittedDraft: AiProviderDraft?
    public private(set) var lastValidateRequest: AiProviderValidateRequest?

    private let initial: AiProviderInput?
    private let validateResult: AiProviderValidateResult

    public init(
        initial: AiProviderInput? = nil,
        validateResult: AiProviderValidateResult = .ok(pinnedIP: nil, probedModel: nil)
    ) {
        self.initial = initial
        self.validateResult = validateResult
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func commitDraft(_ draft: AiProviderDraft) {
        commitCount += 1
        lastCommittedDraft = draft
    }

    public func validate(_ request: AiProviderValidateRequest) async -> AiProviderValidateResult {
        validateCount += 1
        lastValidateRequest = request
        return validateResult
    }

    /// Pushes a settings snapshot to the bound model (test/preview affordance).
    public func push(_ input: AiProviderInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "AIProviderSection" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time. The web keys
/// (`ai.settings.provider.*` / `ai.settings.validate.*`) are preserved verbatim.
public enum AiProviderStrings {
    public static let table = "AIProviderSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds VoiceOver strings from already-localised parts, so spoken content is
/// asserted without rendering the view.
public enum AiProviderAccessibility {
    /// The validate banner's spoken value, e.g. "Validation status: OK — pinned to …".
    public static func validateStatus(format: String, message: String) -> String {
        String(format: format, message)
    }
}
