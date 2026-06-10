//
//  AIFeatureCard.Adapter.swift
//  TeslaSync — P4 shared surface · 0018 · AIFeatureCard (Apple)
//
//  The testable, dependency-light core for the reusable AI-feature scaffold — the SwiftUI parity
//  of `components/ai/AIFeatureCard.tsx`. Everything here is pure (Foundation only): the per-feature
//  content config (web props), the universal "Ask Helix" stream lifecycle (port of the
//  `useAiStream` `AiStreamState`), the P4 connectivity axis, the coalesced input snapshot, the
//  surface metadata (diagnostics slug), the pure button / output decision logic (the verbatim port
//  of the web `AIFeatureCard` + `AiOutputPanel` booleans), and the VoiceOver label builder. No
//  store, no bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web scaffold intentionally does NOT wrap with `withAiFeature` (the gate stays
//  at the call site so each feature is independently gateable) and does NOT own `useAiStream` (the
//  stream is owned by the per-feature component because every feature has its own URL + body). The
//  native surface preserves that contract: it owns no networking and no gate; the host injects the
//  stream lifecycle through the `AIFeatureCardSource` seam, and the card renders the scaffold +
//  the orthogonal P4 leaf freshness axis over it.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity resolver.
public typealias AIFeatureCardResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound feature context — the orthogonal connectivity axis the card renders
/// as a header chip + banner. `live` shows the card alone; `stale` adds a refresh affordance and
/// triggers a one-shot auto-refresh; `offline` keeps the last-known card with an offline marker and
/// disables the action (no stream is possible over a dead connection).
public enum AIFeatureCardConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the verbatim port of the web `useAiStream` `AiStreamState`
/// (`idle | streaming | paused-confirm | done | error`). The card reads this to flip the button
/// label + disable it while in flight and to drive the output panel. `error` carries the terminal
/// message so the panel can render it (web `stream.error`).
public enum AIFeatureStreamPhase: Equatable, Sendable {
    /// No stream has started (web `idle`).
    case idle
    /// SSE open, deltas arriving (web `streaming`).
    case streaming
    /// A tool confirmation is pending (web `paused-confirm`) — still "busy" for button purposes.
    case pausedConfirm
    /// The stream finished cleanly (web `done`).
    case done
    /// The stream ended in error (web `error`), carrying the terminal message.
    case error(String)

    /// Web `stream.state === 'streaming'` — the in-flight flag that flips the button to "thinking".
    public var isStreaming: Bool {
        self == .streaming
    }

    /// Web `stream.state === 'error'`.
    public var isError: Bool {
        if case .error = self { return true }
        return false
    }

    /// Web `state === 'done'`.
    public var isDone: Bool {
        self == .done
    }
}

// MARK: - Button placement (web `buttonPlacement`)

/// Where the action button sits relative to the header — the native port of the web
/// `buttonPlacement`. `inline` (default) places it trailing on the header row; `below` places it on
/// its own right-aligned row beneath the header / input slot. An input slot coerces `below`.
public enum AIFeatureCardButtonPlacement: String, Sendable, Equatable, CaseIterable {
    case inline
    case below
}

// MARK: - Per-feature content (web `AIFeatureCardProps` labels)

/// The per-feature labels the scaffold is parameterised by — the native shape of the web
/// `AIFeatureCardProps` text props. The host passes already-localised strings for the
/// feature-specific `title` / `description` / `buttonLabel` (web "Pass a translated string"); the
/// card resolves the universal Helix copy (badge, "Ask Helix", "Helix is thinking…") itself through
/// the P1/S10 facade. `badgeLabel` overrides the default "Helix" pill text; `buttonTitle` overrides
/// the action's pointer tooltip (web defaults it to `description`).
public struct AIFeatureCardContent: Sendable, Equatable {
    public var title: String
    public var description: String
    public var buttonLabel: String
    public var badgeLabel: String?
    public var emptyHint: String?
    public var buttonTitle: String?

    public init(
        title: String,
        description: String,
        buttonLabel: String,
        badgeLabel: String? = nil,
        emptyHint: String? = nil,
        buttonTitle: String? = nil
    ) {
        self.title = title
        self.description = description
        self.buttonLabel = buttonLabel
        self.badgeLabel = badgeLabel
        self.emptyHint = emptyHint
        self.buttonTitle = buttonTitle
    }

    /// Whether an empty-state hint exists (web `emptyHint != null`) — gates the muted hint line.
    public var hasEmptyHint: Bool {
        guard let emptyHint else { return false }
        return !emptyHint.isEmpty
    }

    /// The pointer tooltip for the action (web `buttonTitle ?? description`).
    public var resolvedButtonTitle: String {
        buttonTitle ?? description
    }
}

// MARK: - Input snapshot (web `stream` slice + `canStart`)

/// One coalesced snapshot of the card's lifecycle inputs — the native mirror of the web injected
/// `stream` slice (`state` / `text` / `error`) plus `canStart` and the P4 connectivity axis. The
/// view binds the model over this; every render decision is a pure function of it.
public struct AIFeatureCardInput: Sendable, Equatable {
    public var phase: AIFeatureStreamPhase
    public var text: String
    public var canStart: Bool
    public var connection: AIFeatureCardConnection

    public init(
        phase: AIFeatureStreamPhase = .idle,
        text: String = "",
        canStart: Bool = true,
        connection: AIFeatureCardConnection = .live
    ) {
        self.phase = phase
        self.text = text
        self.canStart = canStart
        self.connection = connection
    }

    /// The terminal error message when the stream ended in `error`, else `nil` (web `stream.error`).
    public var errorMessage: String? {
        if case let .error(message) = phase { return message }
        return nil
    }
}

// MARK: - Surface metadata (P1/S11 diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`. The
/// scaffold is not gated by a single AI feature id (the `withAiFeature` gate lives at each call
/// site), so unlike the per-feature surfaces there is no `featureID` here.
public enum AIFeatureCardMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIFeatureCard"
}

// MARK: - Pure button / output logic (web `AIFeatureCard` + `AiOutputPanel` branches)

/// The pure decision logic ported from `AIFeatureCard` and `AiOutputPanel`. Each function is a
/// direct translation of a web boolean so the view stays a pure function of these and every branch
/// is unit tested without rendering.
public enum AIFeatureCardLogic {
    /// Web `disabled = !canStart || streaming`, widened with the native leaf contract so the action
    /// cannot fire while offline (no stream is possible over a dead connection).
    public static func buttonDisabled(
        canStart: Bool,
        phase: AIFeatureStreamPhase,
        connection: AIFeatureCardConnection
    ) -> Bool {
        !canStart || phase.isStreaming || connection == .offline
    }

    /// Web `effectivePlacement = inputSlot ? 'below' : buttonPlacement` — an input slot coerces the
    /// button below (a button above an input below is never the intended layout).
    public static func effectivePlacement(
        _ placement: AIFeatureCardButtonPlacement,
        hasInputSlot: Bool
    ) -> AIFeatureCardButtonPlacement {
        hasInputSlot ? .below : placement
    }

    /// Web `!canStart && emptyHint` — the muted empty-state hint shows only when the action can't
    /// start and the feature supplied a hint.
    public static func showsEmptyHint(canStart: Bool, hasEmptyHint: Bool) -> Bool {
        !canStart && hasEmptyHint
    }

    /// Web `AiOutputPanel` `hasAnything = text.length > 0 || state ∈ {streaming, error, done}`.
    public static func outputHasAnything(phase: AIFeatureStreamPhase, hasText: Bool) -> Bool {
        hasText || phase.isStreaming || phase.isDone || phase.isError
    }

    /// Web `text.length === 0 && state === 'streaming'` → the animated thinking indicator.
    public static func thinkingVisible(phase: AIFeatureStreamPhase, hasText: Bool) -> Bool {
        !hasText && phase.isStreaming
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken content is
/// asserted without rendering. The action button keeps the web a11y contract: the visible label is
/// the universal "Ask Helix", but the accessibility label folds in the per-feature verb
/// ("Ask Helix · <buttonLabel>") so screen-reader users hear the specific action.
public enum AIFeatureCardAccessibility {
    /// The action's accessibility label: web ``${askHelix} · ${buttonLabel}``.
    public static func actionLabel(askHelix: String, verb: String) -> String {
        "\(askHelix) · \(verb)"
    }

    /// The badge's accessibility label: the brand name, suffixed with the freshness note when the
    /// snapshot is not live so a non-sighted user learns the card reflects a stale / offline state.
    public static func badgeLabel(
        brand: String,
        connection: AIFeatureCardConnection,
        freshnessNote: String
    ) -> String {
        connection == .live ? brand : "\(brand), \(freshnessNote)"
    }
}
