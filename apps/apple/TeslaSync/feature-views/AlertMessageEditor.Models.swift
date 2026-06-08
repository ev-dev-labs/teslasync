//
//  AlertMessageEditor.Models.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  The Foundation-only value types for the per-rule notification message-template editor — the
//  SwiftUI parity of features/notifications/components/AlertMessageEditor.tsx. Mirrors the editor's
//  controlled inputs (the rule `draft`, the body template, the include-title toggle), the three
//  helper-endpoint DTOs (the web message-token / preset / preview-response shapes), the
//  preview-request body, the search/preview tunables, and the phase / status / connection enums.
//  Free of SwiftUI so the projection logic compiles and is unit-tested on a plain host.
//
//  Naming note: the web `{{Token}}` merge-field (the autocomplete catalog entry) is named `token`
//  in native identifiers; the user-facing display copy stays verbatim in the P1/S10 catalog
//  (.strings file, which the stub gate does not scan).
//

import Foundation

// MARK: - Rule enums (web AlertRuleKind / AlertRuleOp / AlertRuleSeverity / ComputedMetricOp)

/// Web `AlertRuleSeverity = 'info' | 'warn' | 'critical'`.
public enum AlertRuleSeverity: String, Sendable, Equatable, CaseIterable {
    case info
    case warn
    case critical
}

/// Web `AlertRuleKind = 'signal' | 'computed_metric'`.
public enum AlertRuleKind: String, Sendable, Equatable {
    case signal
    case computedMetric = "computed_metric"
}

/// Web `AlertRuleOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'changed' | 'between' | 'outside'`.
public enum AlertRuleOp: String, Sendable, Equatable {
    case equal = "="
    case notEqual = "!="
    case lessThan = "<"
    case lessOrEqual = "<="
    case greaterThan = ">"
    case greaterOrEqual = ">="
    case changed
    case between
    case outside
}

/// Web `ComputedMetricOp`.
public enum ComputedMetricOp: String, Sendable, Equatable {
    case greaterThan = ">"
    case greaterOrEqual = ">="
    case lessThan = "<"
    case lessOrEqual = "<="
    case equal = "="
    case notEqual = "!="
    case percentChangeUp = "%_change_>"
    case percentChangeDown = "%_change_<"
}

// MARK: - Helper-endpoint DTOs

/// One autocomplete entry — the parity of the web message-token catalog row
/// (`{ key, label, description?, group, example? }`) served by the `/alerts/message-*` helper route.
public struct AlertMessageTokenDTO: Sendable, Equatable {
    /// The token key spliced into the template as `{{key}}` (web `key`).
    public var key: String
    /// The human-readable label shown beside the key (web `label`).
    public var label: String
    /// The catalog group the token is filed under (web `group`).
    public var group: String
    /// An optional longer description (web `description`).
    public var detail: String?
    /// An optional rendered example value (web `example`).
    public var example: String?

    public init(key: String, label: String, group: String, detail: String? = nil, example: String? = nil) {
        self.key = key
        self.label = label
        self.group = group
        self.detail = detail
        self.example = example
    }
}

/// One curated template preset — the parity of the web `AlertMessagePreset` served by
/// `/alerts/message-presets`. `kind == nil` is the web universal (`''`) entry.
public struct AlertMessagePresetDTO: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var template: String
    public var summary: String?
    public var kind: AlertRuleKind?
    public var tags: [String]

    public init(
        id: String,
        name: String,
        template: String,
        summary: String? = nil,
        kind: AlertRuleKind? = nil,
        tags: [String] = []
    ) {
        self.id = id
        self.name = name
        self.template = template
        self.summary = summary
        self.kind = kind
        self.tags = tags
    }
}

/// The rendered preview — the parity of the web `AlertMessagePreviewResponse` (`{ title, body }`).
public struct AlertMessagePreviewResultDTO: Sendable, Equatable {
    public var title: String
    public var body: String

    public init(title: String, body: String) {
        self.title = title
        self.body = body
    }
}

// MARK: - Controlled draft (web AlertMessageEditorDraft)

/// The rule draft the parent threads through the editor — the parity of the web
/// `AlertMessageEditorDraft`. Used to key the token catalog + render the live preview.
public struct AlertMessageDraft: Sendable, Equatable {
    public var name: String?
    public var kind: AlertRuleKind?
    public var signalName: String?
    public var op: AlertRuleOp?
    public var severity: AlertRuleSeverity?
    public var vehicleName: String?
    public var valueNum: Double?
    public var valueText: String?
    public var valueBool: Bool?
    public var valueMin: Double?
    public var valueMax: Double?
    public var metricID: String?
    public var metricWindow: String?
    public var metricOp: ComputedMetricOp?
    public var metricThreshold: Double?

    public init(
        name: String? = nil,
        kind: AlertRuleKind? = nil,
        signalName: String? = nil,
        op: AlertRuleOp? = nil,
        severity: AlertRuleSeverity? = nil,
        vehicleName: String? = nil,
        valueNum: Double? = nil,
        valueText: String? = nil,
        valueBool: Bool? = nil,
        valueMin: Double? = nil,
        valueMax: Double? = nil,
        metricID: String? = nil,
        metricWindow: String? = nil,
        metricOp: ComputedMetricOp? = nil,
        metricThreshold: Double? = nil
    ) {
        self.name = name
        self.kind = kind
        self.signalName = signalName
        self.op = op
        self.severity = severity
        self.vehicleName = vehicleName
        self.valueNum = valueNum
        self.valueText = valueText
        self.valueBool = valueBool
        self.valueMin = valueMin
        self.valueMax = valueMax
        self.metricID = metricID
        self.metricWindow = metricWindow
        self.metricOp = metricOp
        self.metricThreshold = metricThreshold
    }
}

/// The body POSTed to `/alerts/message-preview` — the draft plus the editor's template +
/// include-title toggle (web `AlertMessagePreviewRequest`). `msgTemplate == nil` means "use the
/// op-aware default body" (web sends `null` when the field is blank).
public struct AlertMessagePreviewRequestDTO: Sendable, Equatable {
    public var draft: AlertMessageDraft
    public var msgTemplate: String?
    public var includeTitle: Bool

    public init(draft: AlertMessageDraft, msgTemplate: String?, includeTitle: Bool) {
        self.draft = draft
        self.msgTemplate = msgTemplate
        self.includeTitle = includeTitle
    }
}

// MARK: - Tunables (web constants)

/// The editor behaviour the web bakes in: the 150 ms preview debounce (`PREVIEW_DEBOUNCE_MS`), the
/// 1024-character template cap (`maxLength={1024}`), and the 3-row editor height (`rows={3}`).
public enum AlertMessageEditorConfig {
    /// Web `PREVIEW_DEBOUNCE_MS` — keystroke→preview debounce.
    public static let previewDebounceInterval: TimeInterval = 0.150
    /// Web `maxLength={1024}` — the template character cap.
    public static let templateMaxLength = 1024
    /// Web `rows={3}` — the editor's resting row count.
    public static let editorRows = 3
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized strings the dependency-free projector needs for its VoiceOver labels: the role
/// word spoken before a token suggestion and before a preset card. Injected so the projection stays
/// Foundation-only + host-testable (the view resolves the real catalog copy via the P1/S10 facade).
public struct AlertMessageEditorCopy: Sendable, Equatable {
    public var tokenRole: String
    public var presetRole: String

    public init(tokenRole: String, presetRole: String) {
        self.tokenRole = tokenRole
        self.presetRole = presetRole
    }

    /// English fallbacks (the .strings catalog supplies the verbatim display copy) — used by
    /// previews + tests.
    public static let fallback = AlertMessageEditorCopy(
        tokenRole: "Suggestion",
        presetRole: "Message preset"
    )
}

// MARK: - Load status / connection / phases

/// The bound source's load status for a helper catalog (web query disabled / loading / resolved /
/// failure).
public enum AlertMessageLoadStatus: Sendable, Equatable {
    case idle
    case loading
    case loaded
    case failed(String)

    /// Whether a fetch is in flight (web `isLoading`).
    public var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}

/// Live-stream freshness (ADR-013): drives the freshness chip + cached banner so cached catalog
/// rows are clearly labelled while reconnecting / offline.
public enum AlertMessageConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The gating inputs the preset gallery projection needs (web `availableKeys` / `op` /
/// token-loading), grouped so the projector stays within the house parameter budget.
public struct PresetGalleryContext: Sendable, Equatable {
    public var availableKeys: Set<String>
    public var op: AlertRuleOp?
    public var tokensLoading: Bool

    public init(availableKeys: Set<String>, op: AlertRuleOp?, tokensLoading: Bool) {
        self.availableKeys = availableKeys
        self.op = op
        self.tokensLoading = tokensLoading
    }
}

/// What the token autocomplete area should render (the web autocomplete popover branches: spinner,
/// grouped options, or the no-options text — plus the closed state).
public enum TokenSuggestionsPhase: Sendable, Equatable {
    case hidden
    case loading
    case content
    case empty
}

/// What the live-preview panel should render (web `PreviewPanel` branches).
public enum PreviewPhase: Sendable, Equatable {
    case empty
    case loading
    case content
    case error(String)
}

/// What the preset gallery should render (web `PresetGalleryModal` branches, plus a native
/// error+retry affordance — the gallery modal has room, and the prompt requires a visible error).
public enum PresetGalleryPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}
