//
//  Toggle.Adapter.swift
//  TeslaSync — P4 shared surface · 0230 · Toggle (Apple)
//
//  The testable, dependency-light core for the switch toggle — the SwiftUI parity of
//  `components/ui/Toggle.tsx`. Everything here is pure (Foundation only): the input snapshot, the
//  size variants, the `useId`-equivalent identifier resolution, and the VoiceOver name builder. No
//  store, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note — states. The web source is a controlled primitive: it receives `checked` / `onChange`
//  from its parent and reads `useId` for the label association id. It performs NO data fetch — `useId`
//  is id generation, not a query — so it has no loading / empty / error / stale / offline axis.
//  Synthesising network chrome here would invent state the source does not have (the same disposition
//  as the sibling synchronous-primitive surfaces: 0226 Slider, 0087 RangeReadout, 0085 Distance,
//  0075 AnimatedNumber). The genuine render branches this core models are exactly the web's: the
//  on / off state (web `checked`, the track tint + thumb offset), the optional trailing label (web
//  `{label && …}`), and the two size variants (web `size: 'sm' | 'md'`). `checked` is a required
//  prop — there is no missing-value branch.
//
//  Parity note — i18n. The web `Toggle` renders NO translatable copy of its own: the visible `label`
//  is caller-supplied and the control's accessible name is derived from it (`aria-labelledby`). The
//  only native-owned string is the fallback accessible name for the unlabeled switch — a native
//  refinement over the web, whose `aria-labelledby` is simply `undefined` when no label is given,
//  leaving the control unnamed. It is resolved through the injected P1/S10 facade. See Toggle.strings.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. A plain closure so the pure core needs no bundle: the app passes the
/// P1/S10 facade, tests pass the identity-fallback resolver.
public typealias ToggleResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Size variants (web `size: 'sm' | 'md'`)

/// The two track sizes the web source supports. The web draws explicit Tailwind dimensions
/// (`sm: h-5 w-9`, `md: h-6 w-11`); the native parity maps each to a platform `ControlSize` at the
/// view boundary (see Toggle.Views) so the switch stays HIG-idiomatic rather than a hand-drawn track.
/// Raw values mirror the web prop literals so a string prop round-trips through `from(_:)`.
public enum ToggleSize: String, Sendable, Equatable, CaseIterable {
    /// Web `'sm'` — the compact track.
    case small = "sm"
    /// Web `'md'` — the default track.
    case medium = "md"

    /// Map a web `size` literal to the variant — the parity of `size = 'md'`'s default. An absent or
    /// unrecognised value falls back to the default size.
    public static func from(_ web: String?) -> ToggleSize {
        guard let web, let size = ToggleSize(rawValue: web) else { return ToggleMeta.defaultSize }
        return size
    }
}

// MARK: - Surface metadata (diagnostics slug + lib defaults)

/// Static, non-identifying surface constants — the P1/S11 diagnostics slug emitted with
/// `view.opened`, the web `size` default (`md`), and the `useId`-equivalent identifier prefix.
public enum ToggleMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = "Toggle"

    /// Web `size = 'md'` default.
    public static let defaultSize: ToggleSize = .medium

    /// The auto-generated identifier prefix — the native parity of the web `useId()` label id.
    public static let identifierPrefix = "toggle"

    /// Resolve the element identifier — the native parity of the web `useId()` label association id.
    /// An explicit, non-blank id wins; otherwise a stable unique id is generated.
    public static func makeIdentifier(_ explicit: String?) -> String {
        if let explicit, !explicit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return explicit
        }
        return "\(identifierPrefix)-\(UUID().uuidString.lowercased())"
    }
}

// MARK: - Input snapshot (web `ToggleProps` minus the closure)

/// One coalesced snapshot of the toggle's value-type inputs — the web `checked` / `label` / `size`
/// props plus the resolved element id. The `onChange` closure is NOT part of the snapshot (closures
/// are not `Equatable`); it is held by the model and applied to this snapshot, so the view can
/// re-sync the model whenever any value-type prop changes via `onChange(of:)`.
public struct ToggleInput: Sendable, Equatable {
    /// The current on / off state (web `checked`, required).
    public var isOn: Bool
    /// The optional visible label (web `label`). `nil` or empty renders no label row — matching the
    /// web `{label && …}` string-falsiness guard.
    public var label: String?
    /// The track size variant (web `size`, default `md`).
    public var size: ToggleSize
    /// Resolved element id (web `id` / `useId()` label association).
    public var identifier: String

    public init(
        isOn: Bool,
        label: String? = nil,
        size: ToggleSize = ToggleMeta.defaultSize,
        identifier: String = ToggleMeta.identifierPrefix
    ) {
        self.isOn = isOn
        self.label = label
        self.size = size
        self.identifier = identifier
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the switch's visible label + VoiceOver name without rendering the view. The visible label
/// mirrors the web `{label && …}` guard (a `nil` or empty string is no label); the accessible name is
/// that label, or — for the unlabeled switch — the localized fallback (the native refinement over the
/// web, whose `aria-labelledby` is `undefined` with no label, leaving the control unnamed).
public enum ToggleAccessibility {
    /// The visible label — the web `{label && <span>…</span>}` branch. Returns `nil` for a `nil` or
    /// empty string (JS string falsiness), so the trailing label row is omitted.
    public static func visibleLabel(_ label: String?) -> String? {
        guard let label, !label.isEmpty else { return nil }
        return label
    }

    /// The accessible name — the visible label when present, otherwise the localized fallback so the
    /// switch is always named for VoiceOver (web leaves an unlabeled switch with no accessible name).
    public static func name(_ label: String?, strings: ToggleResolve) -> String {
        visibleLabel(label) ?? strings("toggle.accessibility.unlabeled", "Toggle")
    }
}
