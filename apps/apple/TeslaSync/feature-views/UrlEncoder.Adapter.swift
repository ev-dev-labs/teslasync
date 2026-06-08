//
//  UrlEncoder.Adapter.swift
//  TeslaSync — P4 feature view · 0023 · UrlEncoder (Apple)
//
//  The testable transform core: the URL-component encode/decode codec (a faithful
//  port of the web `encodeURIComponent` / `decodeURIComponent` the source calls)
//  plus the projection it produces and the VoiceOver summary builder. All pure +
//  dependency-free so the adapter can be unit-tested without a store, a bundle, or
//  a rendered view (parity with the web `useMemo` body).
//

import Foundation

// MARK: - Mode (web `'encode' | 'decode'`)

/// The transform direction the tool runs, mirroring the web `mode` state.
public enum UrlEncoderMode: String, CaseIterable, Sendable, Equatable {
    case encode
    case decode
}

// MARK: - Result (web `output` memo: '' / value / 'Invalid Input')

/// The projected output the view renders, mirroring the three branches the web
/// `useMemo` produces: the empty sentinel (`if (!inputVal) return ''`), a computed
/// value, or the invalid-input fallback (the `try/catch` path).
public enum UrlEncoderResult: Equatable, Sendable {
    /// No input yet — the web hides the output panel (`{output && …}`); native
    /// renders a friendly empty hint instead of a blank box.
    case empty
    /// A successfully encoded/decoded value.
    case value(String)
    /// The transform threw (web `catch { return t('Invalid Input') }`).
    case invalid
}

// MARK: - Codec (port of encodeURIComponent / decodeURIComponent)

/// The pure URL-component codec. `encode` reproduces JavaScript
/// `encodeURIComponent` exactly — every byte is percent-encoded except the
/// unreserved set `A–Z a–z 0–9 - _ . ! ~ * ' ( )` — so non-ASCII is emitted as
/// UTF-8 percent triples (e.g. `é` → `%C3%A9`) and ` `/`&`/`=` become
/// `%20`/`%26`/`%3D` (the web example `hello world&foo=bar` →
/// `hello%20world%26foo%3Dbar`). `decode` reproduces `decodeURIComponent`,
/// returning `.invalid` for malformed escapes / invalid UTF-8 (the web `catch`).
public enum UrlEncoderCodec {
    /// JS `encodeURIComponent` unreserved set. Built from an explicit ASCII string
    /// (NOT `CharacterSet.alphanumerics`, which contains Unicode letters the web
    /// would percent-encode) and computed per call so it carries no shared mutable
    /// state under Swift 6 strict concurrency.
    static var unreserved: CharacterSet {
        CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
    }

    /// Projects the input + mode into the view-ready result (web `useMemo`).
    public static func transform(_ input: String, mode: UrlEncoderMode) -> UrlEncoderResult {
        guard !input.isEmpty else { return .empty }
        let transformed: String? = switch mode {
        case .encode: encode(input)
        case .decode: decode(input)
        }
        guard let transformed else { return .invalid }
        return .value(transformed)
    }

    /// `encodeURIComponent(input)`. Returns `nil` only on an impossible encoding
    /// failure (mapped to `.invalid` by `transform`); JS encode never throws here.
    public static func encode(_ input: String) -> String? {
        input.addingPercentEncoding(withAllowedCharacters: unreserved)
    }

    /// `decodeURIComponent(input)`. `nil` on malformed `%` escapes or invalid
    /// UTF-8 — the web `catch` path that yields the "Invalid Input" message.
    public static func decode(_ input: String) -> String? {
        input.removingPercentEncoding
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver summary for the output region. Pure + public so the spoken
/// content is unit-testable without rendering the view. The labels resolve through
/// the injected localizer (bundle-free in tests).
public enum UrlEncoderAccessibility {
    public static func outputSummary(
        for result: UrlEncoderResult,
        localize: (String, String) -> String
    ) -> String {
        switch result {
        case .empty:
            localize("urlEncoder.emptyTitle", "Nothing to show yet")
        case let .value(value):
            "\(localize("Output Label", "Output Label")): \(value)"
        case .invalid:
            localize("Invalid Input", "Invalid Input")
        }
    }
}
