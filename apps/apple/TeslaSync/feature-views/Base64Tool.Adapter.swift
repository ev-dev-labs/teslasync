//
//  Base64Tool.Adapter.swift
//  TeslaSync — P4 feature view · 0011 · Base64Tool (Apple)
//
//  The testable projection core for the Base64 devtools utility: the encode /
//  decode transform (a faithful port of the web `btoa` / `atob` + `try/catch`
//  fallback in features/admin/components/devtools/tools/Base64Tool.tsx), the
//  surface slug, and the VoiceOver summary builder. Everything here is pure and
//  dependency-free so it can be unit-tested without a bundle or a rendered view.
//

import Foundation

// MARK: - Mode (web `'encode' | 'decode'`)

/// The two transform directions, mirroring the web `useState<'encode' | 'decode'>`.
public enum Base64Mode: String, Sendable, Equatable, CaseIterable {
    case encode
    case decode

    /// The mode-specific example input shown before typing (web input hint). These
    /// are the verbatim example strings from the web source, not user-facing copy.
    public var example: String {
        switch self {
        case .encode: "Hello World"
        case .decode: "SGVsbG8gV29ybGQ="
        }
    }
}

// MARK: - Result (web `output` memo)

/// The computed transform result. Mirrors the web `useMemo` that returns `''`
/// (no input), the transformed string, or the localized "Invalid Input" message
/// when `btoa` / `atob` throws.
public enum Base64Result: Sendable, Equatable {
    /// No input yet — the web hides the output panel (`{output && …}`).
    case empty
    /// `btoa` succeeded.
    case encoded(String)
    /// `atob` succeeded.
    case decoded(String)
    /// The transform threw (web `catch`) — non-Latin-1 encode input or malformed
    /// base64 on decode.
    case invalid

    /// The string to render in the output panel, or `nil` when there is nothing
    /// to show (empty / invalid carry no value — invalid renders its own message).
    public var value: String? {
        switch self {
        case let .encoded(text), let .decoded(text): text
        case .empty, .invalid: nil
        }
    }

    /// Whether a successful transform produced output (drives the output panel).
    public var hasOutput: Bool {
        value != nil
    }

    /// Whether the transform failed (drives the inline error treatment).
    public var isInvalid: Bool {
        self == .invalid
    }
}

// MARK: - Codec (port of web `btoa` / `atob`)

/// The pure encode / decode transform. Reproduces the web semantics exactly:
/// `btoa` rejects code points above 0xFF, `atob` rejects malformed base64; both
/// failures collapse to `.invalid` (the web `catch` branch).
public enum Base64Codec {
    /// Transforms `input` for `mode`, returning `.empty` for blank input to match
    /// the web `if (!inputVal) return ''`.
    public static func transform(_ input: String, mode: Base64Mode) -> Base64Result {
        guard !input.isEmpty else { return .empty }
        switch mode {
        case .encode: return encode(input)
        case .decode: return decode(input)
        }
    }

    /// `btoa(input)` — encodes the Latin-1 byte view of `input`. Any scalar above
    /// 0xFF is outside the `btoa` domain and yields `.invalid` (web throws).
    private static func encode(_ input: String) -> Base64Result {
        var bytes = [UInt8]()
        bytes.reserveCapacity(input.unicodeScalars.count)
        for scalar in input.unicodeScalars {
            guard scalar.value <= 0xFF else { return .invalid }
            bytes.append(UInt8(scalar.value))
        }
        return .encoded(Data(bytes).base64EncodedString())
    }

    /// `atob(input)` — strict base64 decode. Renders the bytes as UTF-8 text when
    /// valid, otherwise as a Latin-1 "binary string" (the `atob` return contract),
    /// so well-formed base64 never collapses to `.invalid` for non-UTF-8 payloads.
    private static func decode(_ input: String) -> Base64Result {
        guard let data = Data(base64Encoded: input) else { return .invalid }
        if let utf8 = String(data: data, encoding: .utf8) {
            return .decoded(utf8)
        }
        let latin1 = String(String.UnicodeScalarView(data.map { UnicodeScalar($0) }))
        return .decoded(latin1)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held here
/// (not on the SwiftUI view) so the slug is reachable from the dependency-free
/// projection layer and its unit tests.
public enum Base64Surface {
    public static let slug = "Base64Tool"
}

// MARK: - Accessibility (VoiceOver summary)

/// Builds the combined VoiceOver summary for the surface result. Strings resolve
/// through an injected localizer (`(key, fallback) -> String`) so the summary is
/// testable without a bundle, exactly like the view's P1/S10 facade.
public enum Base64Accessibility {
    public static func summary(
        mode: Base64Mode,
        result: Base64Result,
        localize: (String, String) -> String
    ) -> String {
        switch result {
        case .empty:
            let key = mode == .encode ? "a11y.base64.emptyEncode" : "a11y.base64.emptyDecode"
            let fallback = mode == .encode ? "Enter text to Base64-encode" : "Enter Base64 to decode"
            return localize(key, fallback)
        case let .encoded(text), let .decoded(text):
            return "\(localize("Output Label", "Output")): \(text)"
        case .invalid:
            return localize("Invalid Input", "Invalid Input")
        }
    }
}
