//
//  AIVoiceMode.Model.swift
//  TeslaSync — P4 shared surface · 0059 · AIVoiceMode (Apple)
//
//  The state-holder seam (P1/S8), the i18n facade (P1/S10), and the telemetry seam (P1/S11) for the
//  Helix voice-mode panel. The view binds through `VoiceModeModel`; no networking and no speech
//  engine live in the view. The web source composes `useAiEnabled('voice-mode')` (the
//  `withAiFeature` gate), `useAiStream('/ai/voice/chat')`, browser `SpeechRecognition` /
//  `speechSynthesis`, and a `localStorage` transcript draft, so the model coalesces the availability
//  gate + the live-state connectivity axis + the current stream snapshot (from the source seam) with
//  the local dictation state (transcript / listening / TTS-enabled / dictation error / support),
//  driving the speech + draft seams while a pure projection (AIVoiceMode.Projection.swift) renders
//  the result.
//
//  Off-mode gate (web ADR-015): `withAiFeature` renders `null` when the feature is disabled — the
//  whole surface is withdrawn. The native `.gated` phase reproduces that, and `view.opened`
//  telemetry is deferred until the gate is open, mirroring the web `data-ai-feature` marker (absent
//  in off mode).
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "AIVoiceMode" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. In test / preview bundles (where the table
/// is absent) `NSLocalizedString` returns the `value:` fallback, keeping the projection
/// deterministic.
public enum VoiceModeStrings {
    public static let table = "AIVoiceMode"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-templated key and substitutes the positional arguments. The template is
    /// localized first, so translators control word order around the substituted values.
    public static func format(_ key: String, _ fallback: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallback), arguments: args)
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the header chip +
/// banner. `live` hides the banner; `stale` / `offline` show it.
public enum VoiceModeConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Availability (web `useAiEnabled` tri-state)

/// The resolved state of the `withAiFeature('voice-mode')` gate — the native peer of `useAiEnabled`,
/// which fails closed while the settings query has not resolved. `loading` keeps the card shape with
/// a skeleton; `failed` surfaces a retryable error; `resolved(enabled:)` either withdraws the
/// surface (off) or presents the card (on).
public enum VoiceModeAvailability: Sendable, Equatable {
    case loading
    case failed(String)
    case resolved(enabled: Bool)
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol VoiceModeTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
/// The slug is a static, non-identifying constant.
public struct OSLogVoiceModeTelemetry: VoiceModeTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source input snapshot (web hooks: useAiEnabled + useAiStream + live-state)

/// One coalesced snapshot of the card's source-driven inputs — the native mirror of the
/// `useAiEnabled` gate, the live-state connectivity, and the current `useAiStream` snapshot
/// (`state` / `text` / `error`). The view never talks to the network; the real source drives the SSE
/// connection and pushes updated snapshots through this value.
public struct VoiceModeInput: Sendable, Equatable {
    public var availability: VoiceModeAvailability
    public var connection: VoiceModeConnection
    public var stream: VoiceModeStreamSnapshot

    public init(
        availability: VoiceModeAvailability = .resolved(enabled: true),
        connection: VoiceModeConnection = .live,
        stream: VoiceModeStreamSnapshot = .idle
    ) {
        self.availability = availability
        self.connection = connection
        self.stream = stream
    }
}

// MARK: - Local dictation state (web component `useState`)

/// The local, speech-driven state the panel owns — the native peer of the web `transcript` /
/// `listening` / `ttsEnabled` / `sttError` / `sttSupported` `useState` values. Coalesced with the
/// source snapshot, this drives the input slot (transcript box + mic / TTS / stop controls) of the
/// projected card.
public struct VoiceModeUIState: Sendable, Equatable {
    public var transcript: String
    public var listening: Bool
    public var ttsEnabled: Bool
    public var sttError: String?
    public var speechSupported: Bool

    public init(
        transcript: String = "",
        listening: Bool = false,
        ttsEnabled: Bool = true,
        sttError: String? = nil,
        speechSupported: Bool = true
    ) {
        self.transcript = transcript
        self.listening = listening
        self.ttsEnabled = ttsEnabled
        self.sttError = sttError
        self.speechSupported = speechSupported
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The localized, view-ready output panel — the projected peer of `VoiceModeOutputKind`. `body` is
/// the prose (or the composed "Helix error: …" / the friendly hint); `accessibilityLabel` is the
/// combined VoiceOver string.
public struct VoiceModeResolvedOutput: Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        case empty
        case thinking
        case prose
        case failed
    }

    public let kind: Kind
    public let body: String
    public let accessibilityLabel: String

    public init(kind: Kind, body: String, accessibilityLabel: String) {
        self.kind = kind
        self.body = body
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The transcript box's resolved content — the prose the user dictated, or the muted hint shown when
/// it is empty (web: the cyan box shows the transcript, else the listening / idle hint).
public struct VoiceModeTranscriptView: Sendable, Equatable {
    public let display: String
    /// Whether `display` is the muted hint (no dictation yet) rather than real transcript text.
    public let isHint: Bool
    public let accessibilityLabel: String

    public init(display: String, isHint: Bool, accessibilityLabel: String) {
        self.display = display
        self.isHint = isHint
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The mic control's resolved state — web flips between "Speak" (start) and "Stop mic" (stop) with
/// the matching `aria-label`; the start form is disabled when dictation is unsupported or Helix is
/// busy.
public struct VoiceModeMicControl: Sendable, Equatable {
    public let isListening: Bool
    public let title: String
    public let accessibilityLabel: String
    public let isDisabled: Bool

    public init(isListening: Bool, title: String, accessibilityLabel: String, isDisabled: Bool) {
        self.isListening = isListening
        self.title = title
        self.accessibilityLabel = accessibilityLabel
        self.isDisabled = isDisabled
    }
}

/// The TTS toggle's resolved state — web "Mute Helix" / "Unmute Helix" with the matching
/// `aria-label` and `aria-pressed`.
public struct VoiceModeTtsControl: Sendable, Equatable {
    public let isEnabled: Bool
    public let title: String
    public let accessibilityLabel: String

    public init(isEnabled: Bool, title: String, accessibilityLabel: String) {
        self.isEnabled = isEnabled
        self.title = title
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The Stop control's resolved labels — present only while Helix is busy (web `isBusy && <Stop>`).
public struct VoiceModeStopControl: Sendable, Equatable {
    public let title: String
    public let accessibilityLabel: String

    public init(title: String, accessibilityLabel: String) {
        self.title = title
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The fully-resolved "ready" card — every string already localized + every flag already derived, so
/// the view is a pure function of this value (web `AIFeatureCard` props + the voice input slot + the
/// derived button + output).
public struct VoiceModeReady: Sendable, Equatable {
    public let title: String
    public let description: String
    public let badge: String
    /// The per-feature contextual verb ("Speak to Helix") surfaced as the second half of the action
    /// button's accessibility name ("Ask Helix · Speak to Helix").
    public let buttonContext: String
    /// The visible button label — "Ask Helix" idle / "Helix is thinking…" while streaming.
    public let actionTitle: String
    public let actionAccessibilityLabel: String
    public let canStart: Bool
    /// Web `emptyHint = transcript.trim() === 0 ? hint : undefined` — the header hint shown beneath
    /// the description while no question has been dictated. `nil` once there is transcript text.
    public let emptyHint: String?
    public let action: VoiceModeAction
    public let transcript: VoiceModeTranscriptView
    public let mic: VoiceModeMicControl
    public let tts: VoiceModeTtsControl
    public let stop: VoiceModeStopControl?
    /// The dictation failure line (web `sttError`), already localized; `nil` when there is none.
    public let sttError: String?
    /// The unsupported hint shown when dictation is unavailable and no error is showing (web
    /// `!sttSupported && !sttError`).
    public let unsupportedHint: String?
    public let output: VoiceModeResolvedOutput

    public init(
        title: String,
        description: String,
        badge: String,
        buttonContext: String,
        actionTitle: String,
        actionAccessibilityLabel: String,
        canStart: Bool,
        emptyHint: String?,
        action: VoiceModeAction,
        transcript: VoiceModeTranscriptView,
        mic: VoiceModeMicControl,
        tts: VoiceModeTtsControl,
        stop: VoiceModeStopControl?,
        sttError: String?,
        unsupportedHint: String?,
        output: VoiceModeResolvedOutput
    ) {
        self.title = title
        self.description = description
        self.badge = badge
        self.buttonContext = buttonContext
        self.actionTitle = actionTitle
        self.actionAccessibilityLabel = actionAccessibilityLabel
        self.canStart = canStart
        self.emptyHint = emptyHint
        self.action = action
        self.transcript = transcript
        self.mic = mic
        self.tts = tts
        self.stop = stop
        self.sttError = sttError
        self.unsupportedHint = unsupportedHint
        self.output = output
    }
}

/// The resolved view-state — `phase` selects the body, `ready` carries the localized card when the
/// gate is open and resolved.
public struct VoiceModeResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Web `withAiFeature` off → the surface renders nothing.
        case gated
        /// The `useAiEnabled` settings query resolving → skeleton chrome.
        case loading
        /// The availability query failed → a retryable error.
        case error(String)
        /// The gate is open → the Helix voice card.
        case ready
    }

    public let phase: Phase
    public let ready: VoiceModeReady?

    public init(phase: Phase, ready: VoiceModeReady? = nil) {
        self.phase = phase
        self.ready = ready
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The source seam the view's model binds through for the availability gate, the connectivity axis,
/// and the `useAiStream` lifecycle. The production app implements this over the AI-enabled settings
/// holder + the `/ai/voice/chat` SSE client; previews and tests use
/// `InMemoryVoiceModeSource`. The view never talks to the network.
@MainActor
public protocol VoiceModeSource: AnyObject {
    var onUpdate: (@MainActor (VoiceModeInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the availability snapshot (header refresh + gate-error retry).
    func refresh()
    /// Opens the voice-chat stream with the trimmed transcript + session id (web `stream.start()`).
    func send(message: String, sessionID: String)
    /// Aborts an in-flight stream (web `cancel()` / unmount).
    func cancel()
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Drive it with `push(_:)`; the call counters +
/// last-sent capture let the wiring + delegation be asserted without a network.
@MainActor
public final class InMemoryVoiceModeSource: VoiceModeSource {
    public var onUpdate: (@MainActor (VoiceModeInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var sendCount = 0
    public private(set) var cancelCount = 0
    public private(set) var lastSentMessage: String?
    public private(set) var lastSentSessionID: String?

    private let initial: VoiceModeInput?

    public init(initial: VoiceModeInput? = nil) {
        self.initial = initial
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

    public func send(message: String, sessionID: String) {
        sendCount += 1
        lastSentMessage = message
        lastSentSessionID = sessionID
    }

    public func cancel() {
        cancelCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: VoiceModeInput) {
        onUpdate?(input)
    }
}
