//
//  Input.Adapter.swift
//  TeslaSync — P4 shared surface · 0217 · Input (Apple)
//
//  The testable, dependency-light core for the text-field primitive — the SwiftUI parity of
//  `components/ui/Input.tsx`. Everything here is pure (Foundation only): the localization seam, the
//  size variants + their pixel metrics (web `px-/py-/text-` per size), the `inputId` resolution (the
//  verbatim port of the web `id || label?.toLowerCase().replace(/\s+/g, '-')`), and the VoiceOver
//  name / hint / help-label builders. No store, no rendered view, so each piece is unit tested in
//  isolation.
//
//  Parity note — states. The web source is a thin, presentational wrapper over a single
//  `<input>` element: it receives `label` / `help` / `error` / `hint` / `icon` / `suffix` / `size`
//  and the native input attributes (`placeholder`, `required`, `disabled`, `id`, the controlled
//  value) from its parent and renders. It performs NO data fetch — there is no React-Query cache, no
//  Promise — so it has no loading / empty / stale / offline axis (there is nothing to fetch, fail,
//  age, or lose connectivity to; the parent owns the bound value). Synthesising network chrome here
//  would invent state the source does not have — the same disposition as the sibling synchronous
//  primitives Checkbox (0204), Toggle (0230), and Accordion (0203). The genuine render branches this
//  core models are exactly the web's: the optional label (+ required marker), the optional help
//  affordance, the leading icon + trailing suffix regions, the error branch (red border + message,
//  which suppresses the hint), the hint branch, the disabled / secure state, and the four size
//  variants (web `size: 'sm' | 'md' | 'lg' | 'auto'`).
//
//  Parity note — i18n. The web `Input` renders NO translatable copy of its own: `label` / `error` /
//  `hint` / `placeholder` are caller-supplied (already-localized) props. The translatable strings in
//  the composed tree come from its children — `<Label>` (`form.required`) and `<HelpIcon>`
//  (`a11y.helpFor`). The native peer reproduces those semantics as accessibility refinements (the
//  spoken "required", the "Help for {field}" trigger name, the "Error: {message}" describedBy, and
//  the unlabeled-field fallback name), each resolved through the injected P1/S10 facade. See
//  Input.strings.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `t(key, fallback)`
/// call. A plain closure so the pure core needs no bundle: the app passes the P1/S10 facade, tests
/// pass an identity / echo resolver.
public typealias InputFieldResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Size variants (web `size: 'sm' | 'md' | 'lg' | 'auto'`)

/// The point metrics of a field size — the native peer of the web Tailwind padding + text scale
/// (`sm: px-2 py-1.5 text-xs`, `md: px-3 py-2 text-sm`, `lg: px-4 py-2.5 text-base`, `auto:
/// density-aware `min-h-d-row`). Kept as `Double` so the pure core has no CoreGraphics dependency;
/// the views cast to `CGFloat`.
public struct InputFieldMetrics: Sendable, Equatable {
    /// Leading / trailing inset of the field content, in points (web `px-` class).
    public let horizontalPadding: Double
    /// Top / bottom inset of the field content, in points (web `py-` class).
    public let verticalPadding: Double
    /// The field text point size (web `text-` class: `xs → 12`, `sm → 14`, `base → 16`).
    public let fontPointSize: Double
    /// The minimum row height, in points. Non-zero only for the density-aware `auto` size, where the
    /// web `min-h-d-row` maps to the platform's 44pt minimum touch row; fixed sizes size to content.
    public let minHeight: Double

    public init(horizontalPadding: Double, verticalPadding: Double, fontPointSize: Double, minHeight: Double) {
        self.horizontalPadding = horizontalPadding
        self.verticalPadding = verticalPadding
        self.fontPointSize = fontPointSize
        self.minHeight = minHeight
    }
}

/// The four field sizes the web source supports. The web draws explicit Tailwind padding + text
/// classes; the native parity maps each to an ``InputFieldMetrics`` so the field scales faithfully.
/// Raw values mirror the web prop literals so a string prop round-trips through `from(_:)`.
public enum InputFieldSize: String, Sendable, Equatable, CaseIterable {
    /// Web `'sm'` — compact (`px-2 py-1.5 text-xs`).
    case small = "sm"
    /// Web `'md'` — the default (`px-3 py-2 text-sm`).
    case medium = "md"
    /// Web `'lg'` — large (`px-4 py-2.5 text-base`).
    case large = "lg"
    /// Web `'auto'` — density-aware (`px-d-pad-x py-d-pad-y text-d-base min-h-d-row`); the native peer
    /// adopts the medium type / inset and enforces the platform's 44pt minimum density row.
    case auto

    /// Map a web `size` literal to the variant — the parity of `size = 'md'`'s default. An absent or
    /// unrecognised value falls back to the default size.
    public static func from(_ web: String?) -> InputFieldSize {
        guard let web, let size = InputFieldSize(rawValue: web) else { return InputFieldMeta.defaultSize }
        return size
    }

    /// The point metrics for the variant — the native peer of the web per-size padding + text scale
    /// (Tailwind units at 1rem = 16pt: `px-2 → 8`, `px-3 → 12`, `px-4 → 16`; `py-1.5 → 6`, `py-2 → 8`,
    /// `py-2.5 → 10`; `text-xs → 12`, `text-sm → 14`, `text-base → 16`).
    public var metrics: InputFieldMetrics {
        switch self {
        case .small: InputFieldMetrics(horizontalPadding: 8, verticalPadding: 6, fontPointSize: 12, minHeight: 0)
        case .medium: InputFieldMetrics(horizontalPadding: 12, verticalPadding: 8, fontPointSize: 14, minHeight: 0)
        case .large: InputFieldMetrics(horizontalPadding: 16, verticalPadding: 10, fontPointSize: 16, minHeight: 0)
        case .auto: InputFieldMetrics(horizontalPadding: 12, verticalPadding: 8, fontPointSize: 14, minHeight: 44)
        }
    }
}

// MARK: - Surface metadata (diagnostics slug + identifier resolution)

/// Static, non-identifying surface constants — the P1/S11 diagnostics slug emitted with `view.opened`,
/// the web `size` default (`md`), and the `inputId` resolution (the verbatim port of the web
/// `id || label?.toLowerCase().replace(/\s+/g, '-')`).
public enum InputFieldMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = "Input"

    /// Web `size = 'md'` default.
    public static let defaultSize: InputFieldSize = .medium

    /// The fallback element id when neither an explicit `id` nor a label is supplied — the native
    /// refinement over the web, which would otherwise derive `undefined`-prefixed describedby ids.
    public static let identifierPrefix = "input"

    /// Slugify a label — the verbatim port of the web `label.toLowerCase().replace(/\s+/g, '-')`:
    /// lowercase, then collapse each run of whitespace to a single hyphen (leading / trailing runs
    /// included, exactly as the JS regex does).
    public static func slugify(_ label: String) -> String {
        label.lowercased().replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
    }

    /// Resolve the field element id — the verbatim port of the web `id || label?.toLowerCase()
    /// .replace(/\s+/g, '-')`: a non-empty explicit `id` wins; otherwise a non-empty label is
    /// slugified; otherwise the stable fallback prefix (the native peer of the web `undefined`).
    public static func resolveIdentifier(id: String?, label: String?) -> String {
        if let id, !id.isEmpty { return id }
        if let label, !label.isEmpty { return slugify(label) }
        return identifierPrefix
    }

    /// Build a child element id — the web `${inputId}-error` / `${inputId}-hint` / `${inputId}-help`.
    public static func elementID(_ base: String, _ suffix: String) -> String {
        "\(base)-\(suffix)"
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the field's VoiceOver name / hint / help-trigger name without rendering the view. The name
/// is the visible label (the web `<label htmlFor>` association), or the placeholder, or the localized
/// unlabeled fallback, with the spoken "required" appended when required (the web `<Label required>`
/// visually-hidden `form.required`). The hint folds the error (web `aria-describedby={id}-error`) or
/// the surviving hint (web `{id}-hint`) into the field's spoken description. The help-trigger name is
/// the web HelpIcon `aria-label = "Help for {field}"`.
public enum InputFieldAccessibility {
    /// The VoiceOver name of the field — the label, else the placeholder, else the localized
    /// unlabeled fallback; the spoken "required" is appended when the field is required.
    public static func name(
        label: String?,
        placeholder: String?,
        isRequired: Bool,
        strings: InputFieldResolve
    ) -> String {
        let base = label ?? placeholder ?? strings("input.accessibility.unlabeled", "Input field")
        guard isRequired else { return base }
        return "\(base) \(strings("input.accessibility.required", "required"))"
    }

    /// The VoiceOver hint of the field — the error voiced as "Error: {message}" (web
    /// `aria-describedby={id}-error`) when present, else the surviving hint (web `{id}-hint`), else
    /// none. The error wins over the hint, mirroring the web's mutually exclusive describedby.
    public static func hint(error: String?, hint: String?, strings: InputFieldResolve) -> String? {
        if let error {
            return String(format: strings("input.accessibility.errorFormat", "Error: %@"), error)
        }
        return hint
    }

    /// The help trigger's VoiceOver name — the web HelpIcon `aria-label = t('a11y.helpFor', { field })`
    /// → "Help for {field}", so screen readers announce which field the help belongs to.
    public static func helpLabel(field: String, strings: InputFieldResolve) -> String {
        String(format: strings("input.accessibility.helpFor", "Help for %@"), field)
    }
}

// MARK: - Input snapshot (web `InputProps` minus the view content + closures)

/// One coalesced snapshot of the field's value-type inputs — the web `label` / `help` / `error` /
/// `hint` / `size` props, the resolved `placeholder` / `required` / `disabled` / secure native input
/// attributes, the resolved element id (web `inputId`), the resolved help field name (web `help.for
/// ?? inputId`), and the presence flags for the leading icon + trailing suffix view regions (the web
/// `icon != null` / `suffix != null`). The icon / suffix view content and the value binding are NOT
/// part of the snapshot (views + bindings are not `Equatable`); they are held by the view, so the
/// view can re-sync the model whenever any value-type prop changes via `onChange(of:)`.
public struct InputFieldInput: Sendable, Equatable {
    /// Resolved element id (web `inputId`).
    public var identifier: String
    /// The optional field label (web `label`). `nil` / empty renders no label row.
    public var label: String?
    /// The optional help text shown by the help affordance (web `help`). `nil` / empty renders no
    /// help trigger (web HelpIcon returns null when its text is empty).
    public var helpText: String?
    /// The field name the help trigger announces (web `help.for ?? inputId`).
    public var helpFieldName: String
    /// The placeholder text (web `placeholder`). `nil` / empty renders no prompt.
    public var placeholder: String?
    /// The error message (web `error`). When non-empty the field is invalid, wears the error border,
    /// shows the message, and suppresses the hint.
    public var error: String?
    /// The supporting hint (web `hint`). Shown only when there is no error (web `{hint && !error}`).
    public var hint: String?
    /// Whether a leading icon region is rendered (web `icon != null` → `pl-10`).
    public var hasIcon: Bool
    /// Whether a trailing suffix region is rendered (web `suffix != null` → `pr-10`).
    public var hasSuffix: Bool
    /// The size variant (web `size`, default `md`).
    public var size: InputFieldSize
    /// Whether the field is required (web `required` → `aria-required`).
    public var isRequired: Bool
    /// Whether the field is disabled (web `disabled`) — dimmed and non-interactive.
    public var isDisabled: Bool
    /// Whether the field masks its content (the native peer of the web `<input type="password">`).
    public var isSecure: Bool

    public init(
        identifier: String = InputFieldMeta.identifierPrefix,
        label: String? = nil,
        helpText: String? = nil,
        helpFieldName: String = InputFieldMeta.identifierPrefix,
        placeholder: String? = nil,
        error: String? = nil,
        hint: String? = nil,
        hasIcon: Bool = false,
        hasSuffix: Bool = false,
        size: InputFieldSize = InputFieldMeta.defaultSize,
        isRequired: Bool = false,
        isDisabled: Bool = false,
        isSecure: Bool = false
    ) {
        self.identifier = identifier
        self.label = label
        self.helpText = helpText
        self.helpFieldName = helpFieldName
        self.placeholder = placeholder
        self.error = error
        self.hint = hint
        self.hasIcon = hasIcon
        self.hasSuffix = hasSuffix
        self.size = size
        self.isRequired = isRequired
        self.isDisabled = isDisabled
        self.isSecure = isSecure
    }
}
