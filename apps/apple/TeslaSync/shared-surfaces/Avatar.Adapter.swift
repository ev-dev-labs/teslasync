//
//  Avatar.Adapter.swift
//  TeslaSync — P4 shared surface · 0076 · Avatar (Apple)
//
//  The testable, dependency-light projection core for the shared Avatar primitive — the SwiftUI
//  parity of `components/data-display/Avatar.tsx`. Everything here is pure (Foundation only): the
//  deterministic colour machinery (the verbatim port of the web `djb2` hash + `avatarColorIndex`),
//  the initials derivation (`avatarInitials`), the seed + attribution rules, the WCAG-aware ink
//  tone, the input descriptor, the resolved view-state, the projection, the surface metadata, and
//  the accessibility builder. No SwiftUI, no store, no rendered view, so each piece is unit tested
//  in isolation against the web reference. The value tokens (size / shape / status / kind /
//  palette) live in `Avatar.Tokens.swift`.
//
//  Parity note: the web Avatar renders one of three visuals in priority order — a remote `src`
//  image (falling back to initials/glyph on load error), deterministic 2-letter initials on a
//  hashed colour disc, or a generic glyph (`User` for `kind="user"`, the Helix brand mark for
//  `kind="bot"`). The colour is `CHART_COLORS_CB_SAFE[djb2(seed) % 8]` — the Okabe-Ito palette,
//  which is byte-for-byte the generated `Color.TS.chartCategorical` design token (P1/S9). This
//  core reproduces that machinery exactly so the same seed renders the same colour on web + Apple.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a
/// bundle: the production app passes the P1/S10 facade, while tests pass the identity resolver.
public typealias AvatarResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Deterministic hash (verbatim port of web `djb2` + `avatarColorIndex`)

/// The deterministic, non-cryptographic string → palette-index machinery — the verbatim port of
/// the web `djb2` hash and `avatarColorIndex`. The hash is computed over UTF-16 code units (the
/// web `charCodeAt`) with 32-bit overflow semantics (the web `(hash * 33) ^ char` then `>>> 0`),
/// so the same seed yields the same swatch on web + Apple. Pinned against the web reference in the
/// test suite.
public enum AvatarHash {
    /// The djb2 hash of a string — `hash = hash * 33 ^ codeUnit`, 32-bit, returned unsigned
    /// (web `>>> 0`).
    public static func djb2(_ input: String) -> UInt32 {
        var hash: Int32 = 5381
        for unit in input.utf16 {
            // `hash * 33` is computed in 64 bits then truncated to a signed 32-bit value — the
            // native parity of JavaScript's ToInt32 coercion before the XOR.
            let stepped = Int64(hash) &* 33
            hash = Int32(truncatingIfNeeded: stepped) ^ Int32(unit)
        }
        return UInt32(bitPattern: hash)
    }

    /// The palette index for a seed — `djb2(seed) % CHART_COLORS_CB_SAFE.length` (web).
    public static func colorIndex(for seed: String) -> Int {
        Int(djb2(seed) % UInt32(AvatarPalette.count))
    }
}

// MARK: - Identity derivation (verbatim port of web seed / initials / attribution)

/// The pure identity derivations — the seed used for the colour hash, the visible initials, and
/// whether the avatar is "attributed" (has a name or id to colour for). Verbatim ports of the web
/// `seed`, `avatarInitials`, and `isAttributed` expressions.
public enum AvatarIdentity {
    /// The colour-hash seed — `userId` when non-empty, else the trimmed name, else `"?"` (web
    /// `(userId && userId.length > 0 ? userId : trimmedName) || '?'`).
    public static func seed(userId: String?, trimmedName: String) -> String {
        let identifier = userId ?? ""
        let base = identifier.isEmpty ? trimmedName : identifier
        return base.isEmpty ? "?" : base
    }

    /// The visible initials — first letters of the first two words; for a single word the first
    /// two characters; `"?"` for empty / whitespace-only input. Verbatim port of `avatarInitials`.
    public static func initials(for name: String?) -> String {
        guard let name else { return "?" }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "?" }
        let parts = trimmed.split(whereSeparator: \.isWhitespace).map(String.init)
        guard let first = parts.first else { return "?" }
        if parts.count >= 2 {
            let lead = first.first.map(String.init) ?? ""
            let follow = parts[1].first.map(String.init) ?? ""
            return (lead + follow).uppercased()
        }
        return String(first.prefix(2)).uppercased()
    }

    /// Whether the avatar has something to attribute a colour to — a name or a non-empty id (web
    /// `trimmedName.length > 0 || (userId != null && userId !== '')`). When false the fallback
    /// disc uses a neutral surface rather than a hashed colour.
    public static func isAttributed(userId: String?, trimmedName: String) -> Bool {
        if !trimmedName.isEmpty { return true }
        if let userId, !userId.isEmpty { return true }
        return false
    }
}

// MARK: - WCAG contrast helpers

/// Pure WCAG contrast helpers — relative luminance and the contrast ratio between two luminances.
/// Used to choose the ink tone and asserted directly in the test suite.
public enum AvatarContrast {
    /// The WCAG 2.1 relative luminance of an sRGB colour.
    public static func relativeLuminance(red: Double, green: Double, blue: Double) -> Double {
        func linear(_ value: Double) -> Double {
            value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }

    /// The WCAG 2.1 relative luminance of a palette swatch.
    public static func relativeLuminance(of swatch: AvatarSwatch) -> Double {
        relativeLuminance(red: swatch.red, green: swatch.green, blue: swatch.blue)
    }

    /// The WCAG contrast ratio between two relative luminances (order-independent).
    public static func ratio(_ lhs: Double, _ rhs: Double) -> Double {
        let lighter = max(lhs, rhs)
        let darker = min(lhs, rhs)
        return (lighter + 0.05) / (darker + 0.05)
    }

    /// The minimum acceptable contrast for the bold initials — WCAG 2.1 AA large text.
    public static let largeTextMinimum: Double = 3.0
}

// MARK: - Ink tone (WCAG-aware foreground over the swatch)

/// The foreground tone for initials / glyph drawn over a colour swatch. The web hard-codes white
/// on every swatch; on Apple we keep white (the web default) unless white fails the WCAG 2.1
/// AA large-text contrast ratio (3:1) on that swatch — the light Okabe-Ito swatches (orange,
/// yellow, sky blue) flip to dark ink so the initials stay legible. A documented, tested
/// accessibility improvement over the web's fixed white, not silent drift.
public enum AvatarInkTone: String, Sendable, Equatable, CaseIterable {
    /// White text — the web default, used on every swatch where it meets AA large-text contrast.
    case white
    /// Dark ink — used on the light swatches where white text fails AA large-text contrast.
    case ink

    /// The relative luminance of the dark ink colour the views render (`white: 0.12` sRGB), used
    /// as the contrast reference for the AA-large invariant the test suite asserts.
    public static let inkLuminance: Double = AvatarContrast.relativeLuminance(
        red: 0.12,
        green: 0.12,
        blue: 0.12
    )

    /// The ink tone for a swatch index — white unless it fails AA large-text contrast, then ink.
    public static func forIndex(_ index: Int) -> AvatarInkTone {
        let swatchLuminance = AvatarContrast.relativeLuminance(of: AvatarPalette.swatch(forIndex: index))
        let whiteContrast = AvatarContrast.ratio(1.0, swatchLuminance)
        return whiteContrast >= AvatarContrast.largeTextMinimum ? .white : .ink
    }

    /// The relative luminance of this tone's rendered colour (white vs. the dark ink).
    public var luminance: Double {
        switch self {
        case .white: 1.0
        case .ink: AvatarInkTone.inkLuminance
        }
    }
}

// MARK: - Fallback content (web render priority — initials vs. generic glyph)

/// The non-image fallback the disc renders — deterministic initials when a name yields them, else
/// the generic glyph chosen by kind. The verbatim port of the web `hasNameInitials ? initials :
/// <GenericIcon />` branch (the image, when present, is layered over this by the view).
public enum AvatarFallback: Sendable, Equatable {
    case initials(String)
    case glyph(AvatarKind)
}

// MARK: - Input descriptor (the surface inputs — web component props)

/// One coalesced snapshot of the avatar's inputs — the native mirror of the web `AvatarProps`.
/// The P1/S8 source emits this; the view binds the model over it. The only "fetch" the primitive
/// performs is the optional remote image (the platform parity of the web `<img>`), handled in the
/// view via `AsyncImage`; there is no other networking.
public struct AvatarDescriptor: Sendable, Equatable {
    public var userId: String?
    public var name: String?
    public var src: String?
    public var size: AvatarSize
    public var shape: AvatarShape
    public var status: AvatarStatus?
    public var showTooltip: Bool
    public var kind: AvatarKind

    public init(
        userId: String? = nil,
        name: String? = nil,
        src: String? = nil,
        size: AvatarSize = .sm,
        shape: AvatarShape = .circle,
        status: AvatarStatus? = nil,
        showTooltip: Bool = false,
        kind: AvatarKind = .user
    ) {
        self.userId = userId
        self.name = name
        self.src = src
        self.size = size
        self.shape = shape
        self.status = status
        self.showTooltip = showTooltip
        self.kind = kind
    }

    /// The trimmed display name (web `name?.trim() ?? ''`).
    public var trimmedName: String {
        (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Resolved view-state (web render branches)

/// The resolved, view-ready avatar state — every visual decision pre-computed so the view is a
/// pure function of this value. `hasImage` selects whether the remote image is layered over the
/// fallback; `fallback` is what shows during image load, on image failure, or when there is no
/// image; `isAttributed` selects the hashed colour vs. the neutral disc.
public struct AvatarResolved: Sendable, Equatable {
    public let seed: String
    public let colorIndex: Int
    public let fallback: AvatarFallback
    public let isAttributed: Bool
    public let inkTone: AvatarInkTone
    public let size: AvatarSize
    public let shape: AvatarShape
    public let status: AvatarStatus?
    public let kind: AvatarKind
    public let hasImage: Bool

    public init(
        seed: String,
        colorIndex: Int,
        fallback: AvatarFallback,
        isAttributed: Bool,
        inkTone: AvatarInkTone,
        size: AvatarSize,
        shape: AvatarShape,
        status: AvatarStatus?,
        kind: AvatarKind,
        hasImage: Bool
    ) {
        self.seed = seed
        self.colorIndex = colorIndex
        self.fallback = fallback
        self.isAttributed = isAttributed
        self.inkTone = inkTone
        self.size = size
        self.shape = shape
        self.status = status
        self.kind = kind
        self.hasImage = hasImage
    }
}

// MARK: - Projection (descriptor → resolved view-state)

/// Pure projection from the input descriptor to the resolved view-state — the native port of the
/// web component body's derivations (seed → colour index, initials → fallback, attribution → disc
/// background). The view is a pure function of this value; every branch is unit tested.
public enum AvatarProjection {
    public static func resolve(_ descriptor: AvatarDescriptor) -> AvatarResolved {
        let trimmedName = descriptor.trimmedName
        let seed = AvatarIdentity.seed(userId: descriptor.userId, trimmedName: trimmedName)
        let colorIndex = AvatarHash.colorIndex(for: seed)
        let initials = AvatarIdentity.initials(for: descriptor.name)
        let hasNameInitials = initials != "?"
        let fallback: AvatarFallback = hasNameInitials ? .initials(initials) : .glyph(descriptor.kind)
        let isAttributed = AvatarIdentity.isAttributed(userId: descriptor.userId, trimmedName: trimmedName)
        let hasImage = !(descriptor.src ?? "").isEmpty
        return AvatarResolved(
            seed: seed,
            colorIndex: colorIndex,
            fallback: fallback,
            isAttributed: isAttributed,
            inkTone: AvatarInkTone.forIndex(colorIndex),
            size: descriptor.size,
            shape: descriptor.shape,
            status: descriptor.status,
            kind: descriptor.kind,
            hasImage: hasImage
        )
    }
}

// MARK: - Surface metadata (diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum AvatarMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "Avatar"
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the avatar's VoiceOver strings from already-localised parts, so the spoken content is
/// asserted without rendering the view. The web exposes the name through the image `alt` / tooltip
/// and the presence through the dot's `aria-label`; the native surface folds them into one element
/// (identity as the label, presence as the value).
public enum AvatarAccessibility {
    /// The identity label — the trimmed name, or the localised "Unknown user" when absent (web
    /// `trimmedName || t('avatar.unknown')`).
    public static func identityLabel(trimmedName: String, unknownWord: String) -> String {
        trimmedName.isEmpty ? unknownWord : trimmedName
    }

    /// The localisation key for a presence status — the web `avatar.statusOnline/Idle/Offline`.
    public static func presenceKey(for status: AvatarStatus) -> String {
        switch status {
        case .online: "avatar.statusOnline"
        case .idle: "avatar.statusIdle"
        case .offline: "avatar.statusOffline"
        }
    }

    /// The English fallback for a presence status — the web `t(key, fallback)` default.
    public static func presenceFallback(for status: AvatarStatus) -> String {
        switch status {
        case .online: "Online"
        case .idle: "Idle"
        case .offline: "Offline"
        }
    }
}
