//
//  TagInput.Adapter.swift
//  TeslaSync — P4 shared surface · 0160 · TagInput (Apple)
//
//  The Foundation-only core for the free-text tag chip input — the SwiftUI parity of
//  `components/forms/TagInput.tsx`. Everything here is pure (no SwiftUI, no store, no bundle), so the
//  whole commit/normalise/dedupe/split contract is unit-tested in isolation against the web's own
//  behaviour. It owns the surface identity (the diagnostics slug), the constrained separator set
//  (`TagSeparator`), the tag normaliser (web `normaliseTag`: trim + optional lowercase), the JS-`split`
//  parity tokeniser (web `buildSplitRegex` → `String.split(/[seps\r\n]+/)`), the commit engine (web
//  `tryAddOne` + `commitText`: empty / full / invalid / duplicate / added, preserving the trailing
//  fragment), the removal helper (web `removeAt`), the rotating live-region padding (web
//  `'\u200B'.repeat(n % 4)`), the i18next `{{token}}` interpolation, and the composed accessibility
//  strings. No `@Observable`, no view — each rule is testable on its own.
//
//  Faithful-parity note: the web `TagInput` is a CONTROLLED field — the parent owns the `value` array
//  and receives `onChange(next)`; the field keeps only the in-progress `pending` text + a validation
//  `error`. The native core mirrors that: the engine is a set of pure value→value transforms, and the
//  state-holder (P1/S8) threads the parent's value snapshot + lifecycle through them. As with the
//  sibling controlled input CurrencyInput (0150), the parent's load / error / connectivity is modelled
//  as the P4 leaf axis so every required state renders, while the ready state reproduces every real
//  interaction branch of the source.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11),
/// and the source default for the commit separators. Kept SwiftUI-free so the state-holder can emit
/// telemetry without depending on the view layer.
public enum TagInputMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = "TagInput"

    /// Web default `separators` — comma only, the most common shape for free-text tag entry.
    public static let defaultSeparators: [TagSeparator] = [.comma]

    /// Minimum sensible width (in characters) for the typing field inside the chip strip (web
    /// `min-w-[8ch]`), surfaced here so the view holds no magic number.
    public static let minFieldCharacters = 8
}

// MARK: - Localization seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `useTranslation` `t(key,
/// fallback)` call. A plain closure so the pure core needs no bundle: the app passes the P1/S10
/// facade, tests pass the identity-fallback resolver.
public typealias TagInputResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - TagSeparator (web `TagSeparator = ',' | ';' | ' '`)

/// The constrained set of additional in-text separators that trigger a commit while typing or pasting
/// — the native peer of the web union type. Enter is always an implicit separator regardless of this
/// list; CR / LF are always folded in by the tokeniser so multi-line pastes split per row. Constrained
/// to a fixed set (no user-supplied characters) so the split is always safe.
public enum TagSeparator: Character, Sendable, Equatable, CaseIterable {
    case comma = ","
    case semicolon = ";"
    case space = " "
}

// MARK: - Commit outcome (semantic announcement, web live-region branches)

/// The semantic result a commit wants the assistive technology to voice — the native peer of the web
/// `commitText` announce branch. The state-holder maps this to the localized, padding-suffixed string;
/// keeping it semantic (not pre-localized) makes the engine bundle-free and unit-testable.
public enum TagInputAnnouncementKind: Sendable, Equatable {
    /// Nothing to voice (no tag added, or a validation error blocked the commit).
    case none
    /// `n` tags were added (web `addedOne` for 1, `added` for many).
    case added(Int)
    /// A duplicate was rejected silently (web `duplicate`).
    case duplicate(String)
    /// The `maxTags` cap was hit (web `maxReachedAnnounce`).
    case maxReached
    /// A chip was removed (web `removed`).
    case removed(String)
}

// MARK: - Commit result (web `commitText` return + the new value)

/// The outcome of processing one commit event (a typed separator, Enter, blur, or paste) — the new tag
/// list, the trailing fragment that stays in the field (web `remainder`), how many were added, the
/// first validation error (web `firstError`, already localized by the caller's validator), and the
/// semantic announcement to voice.
public struct TagInputCommit: Sendable, Equatable {
    public let tags: [String]
    public let remainder: String
    public let committed: Int
    public let error: String?
    public let announcement: TagInputAnnouncementKind

    public init(
        tags: [String],
        remainder: String,
        committed: Int,
        error: String?,
        announcement: TagInputAnnouncementKind
    ) {
        self.tags = tags
        self.remainder = remainder
        self.committed = committed
        self.error = error
        self.announcement = announcement
    }
}

/// The outcome of a chip removal — the new tag list and the removed value (for the announcement). A
/// `nil` `removed` means the index was out of range and the list is unchanged (web `removeAt` guard).
public struct TagInputRemoval: Sendable, Equatable {
    public let tags: [String]
    public let removed: String?

    public init(tags: [String], removed: String?) {
        self.tags = tags
        self.removed = removed
    }
}

// MARK: - TagInputEngine (verbatim port of the web commit logic)

/// The pure tag engine — the native port of the web `normaliseTag` / `buildSplitRegex` / `tryAddOne` /
/// `commitText` / `removeAt` plus the live-region padding + i18next interpolation. Every function is
/// deterministic and dependency-light, so the field's behaviour is asserted without a view or a store.
public enum TagInputEngine {
    /// Normalise a candidate tag prior to validation / dedupe — the web `normaliseTag`: trim
    /// surrounding whitespace + newlines (JS `String.trim` parity), then optionally lowercase.
    public static func normalise(_ raw: String, lowercase: Bool) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return lowercase ? trimmed.lowercased() : trimmed
    }

    /// The effective separator scalars — the configured separators plus CR / LF, which are always
    /// folded in so a multi-line paste splits per row (web `buildSplitRegex` appends `\r\n`). Unicode
    /// scalars (not `Character`) so a CRLF pair — a single grapheme cluster in Swift — still splits as
    /// two separators, matching JavaScript's UTF-16 `split`.
    public static func separatorScalars(_ separators: [TagSeparator]) -> Set<Unicode.Scalar> {
        var set = Set(separators.compactMap(\.rawValue.unicodeScalars.first))
        set.insert("\r")
        set.insert("\n")
        return set
    }

    /// Whether `text` contains any commit separator — the web `splitRegex.test(raw)`. Scalar-based so a
    /// pasted CRLF is detected even though it is one Swift `Character`.
    public static func containsSeparator(_ text: String, separators: [TagSeparator]) -> Bool {
        let seps = separatorScalars(separators)
        return text.unicodeScalars.contains { seps.contains($0) }
    }

    /// Split text on maximal runs of the configured separators — a faithful port of JavaScript
    /// `String.prototype.split(/[seps\r\n]+/)`: consecutive separators collapse to one boundary, a
    /// leading separator yields a leading empty token, a trailing separator yields a trailing empty
    /// token, and the empty string yields `[""]`. The trailing token is the caller's "remainder".
    /// Iterates Unicode scalars so a CRLF row break splits correctly.
    public static func splitTokens(_ text: String, separators: [TagSeparator]) -> [String] {
        let seps = separatorScalars(separators)
        var tokens: [String] = []
        var current = String.UnicodeScalarView()
        var prevWasSeparator = false
        for scalar in text.unicodeScalars {
            if seps.contains(scalar) {
                if !prevWasSeparator {
                    tokens.append(String(current))
                    current = String.UnicodeScalarView()
                }
                prevWasSeparator = true
            } else {
                current.append(scalar)
                prevWasSeparator = false
            }
        }
        tokens.append(String(current))
        return tokens
    }

    /// Process one commit event — the web `commitText`. Splits `raw` on the configured separators, runs
    /// every fragment EXCEPT the trailing one through the add rules (the trailing fragment stays in the
    /// field as `remainder`, so a mid-string separator never consumes the text still being typed),
    /// accumulates the survivors, and reports the first validation error + the semantic announcement.
    /// To force-commit the trailing fragment too (Enter / blur / paste), the caller appends a separator
    /// to `raw` first (web `commitAll`).
    public static func commit(
        text raw: String,
        into value: [String],
        separators: [TagSeparator],
        lowercase: Bool,
        maxTags: Int?,
        validate: ((String) -> String?)? = nil
    ) -> TagInputCommit {
        let parts = splitTokens(raw, separators: separators)
        var accumulated = value
        var firstError: String?
        var added = 0
        var lastDuplicate: String?
        var hitMax = false
        var remainder = ""

        loop: for (index, part) in parts.enumerated() {
            if index == parts.count - 1 {
                remainder = part
                break
            }
            let result = tryAdd(
                part,
                into: accumulated,
                lowercase: lowercase,
                maxTags: maxTags,
                validate: validate
            )
            switch result.status {
            case .added:
                accumulated = result.next
                added += 1
            case let .invalid(message):
                if firstError == nil { firstError = message }
            case .duplicate:
                lastDuplicate = result.tag
            case .full:
                hitMax = true
                break loop
            case .empty:
                continue
            }
        }

        return TagInputCommit(
            tags: accumulated,
            remainder: remainder,
            committed: added,
            error: firstError,
            announcement: announcement(
                firstError: firstError,
                added: added,
                lastDuplicate: lastDuplicate,
                hitMax: hitMax
            )
        )
    }

    /// Remove the chip at `index` — the web `removeAt`. Out-of-range indices leave the list unchanged
    /// (and report `nil`), so a stale tap can never crash or drop the wrong chip.
    public static func removeAt(_ index: Int, from value: [String]) -> TagInputRemoval {
        guard index >= 0, index < value.count else {
            return TagInputRemoval(tags: value, removed: nil)
        }
        var next = value
        let removed = next.remove(at: index)
        return TagInputRemoval(tags: next, removed: removed)
    }

    // MARK: A11y live-region padding (web rotating zero-width-space dedupe)

    /// U+200B ZERO WIDTH SPACE — invisible on screen and unspoken, exactly as the web uses it to force
    /// the assistive technology to re-read an identical consecutive announcement.
    public static let zeroWidthSpace = "\u{200B}"

    /// The rotating dedupe suffix — `sequence mod 4` zero-width spaces, the verbatim port of the web
    /// `announce`'s `'\u200B'.repeat(announceCounter % 4)`. The modulo keeps the suffix bounded.
    public static func announcementPadding(sequence: Int) -> String {
        let count = ((sequence % 4) + 4) % 4
        return String(repeating: zeroWidthSpace, count: count)
    }

    // MARK: Interpolated copy (web i18next `{{token}}`)

    /// Replace `{{token}}` markers in a resolved template with the supplied values — the native
    /// port of i18next interpolation, so the per-surface strings keep the web's `{{count}}` / `{{tag}}`
    /// / `{{tags}}` shapes and stay translator-friendly.
    public static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }

    /// Join the current tags for the screen-reader enumeration — the web `value.join(', ')`.
    public static func joinTags(_ tags: [String]) -> String {
        tags.joined(separator: ", ")
    }

    /// Compose the field's VoiceOver label from the (already-localized) field label and the current
    /// tags summary — "{label}, {summary}" — so VoiceOver never lands on a bare, context-free control.
    public static func fieldAccessibilityLabel(label: String, summary: String) -> String {
        let trimmed = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? label : "\(label), \(trimmed)"
    }

    // MARK: Private — the per-fragment add rules (web `tryAddOne`)

    private enum AddStatus: Equatable {
        case added
        case duplicate
        case invalid(String)
        case empty
        case full
    }

    /// One fragment's add result — the status, the normalised tag, and the (possibly grown) list. A
    /// struct rather than a tuple so the result stays self-documenting at the call site.
    private struct AddOutcome {
        let status: AddStatus
        let tag: String
        let next: [String]
    }

    /// Try to add a single normalised fragment to `accumulated` — the web `tryAddOne`. The rule order
    /// is verbatim: normalise → reject empty → reject when full → run the caller's validator → reject a
    /// case-insensitive duplicate → otherwise accept. The duplicate check is always case-insensitive
    /// regardless of the `lowercase` storage flag, so "FOO" and "foo" never coexist.
    private static func tryAdd(
        _ raw: String,
        into accumulated: [String],
        lowercase: Bool,
        maxTags: Int?,
        validate: ((String) -> String?)?
    ) -> AddOutcome {
        let tag = normalise(raw, lowercase: lowercase)
        if tag.isEmpty { return AddOutcome(status: .empty, tag: tag, next: accumulated) }
        if let maxTags, accumulated.count >= maxTags {
            return AddOutcome(status: .full, tag: tag, next: accumulated)
        }
        if let validate, let message = validate(tag) {
            return AddOutcome(status: .invalid(message), tag: tag, next: accumulated)
        }
        let lower = tag.lowercased()
        if accumulated.contains(where: { $0.lowercased() == lower }) {
            return AddOutcome(status: .duplicate, tag: tag, next: accumulated)
        }
        return AddOutcome(status: .added, tag: tag, next: accumulated + [tag])
    }

    /// Pick the announcement for a commit — voiced only when no validation error blocked it (web's `if
    /// (firstError === null)` gate), preferring additions, then the last duplicate, then the cap.
    private static func announcement(
        firstError: String?,
        added: Int,
        lastDuplicate: String?,
        hitMax: Bool
    ) -> TagInputAnnouncementKind {
        guard firstError == nil else { return .none }
        if added > 0 { return .added(added) }
        if let lastDuplicate { return .duplicate(lastDuplicate) }
        if hitMax { return .maxReached }
        return .none
    }
}
