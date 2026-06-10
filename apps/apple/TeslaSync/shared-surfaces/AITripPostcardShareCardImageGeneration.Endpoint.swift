//
//  AITripPostcardShareCardImageGeneration.Endpoint.swift
//  TeslaSync — P4 shared surface · 0056 · AITripPostcardShareCardImageGeneration (Apple)
//
//  The request seam + accessibility summaries for the trip postcard / share-card image-prompt
//  drafter, split from the stream-codec core for the lint length budget: the propose-only draft body
//  (web `useMemo` payload), the static draft endpoint + `numericTripId` rule + JSON encoder (web
//  `useAiStream({ url, body })`), and the VoiceOver label builders. All pure (Foundation only) so the
//  body shape, the style-hint trimming, the encoding, and the spoken strings are unit tested in
//  isolation — no store, no bundle, no rendered view.
//

import Foundation

// MARK: - Draft request body (web `useMemo` body builder)

/// The propose-only draft body — the native mirror of the web `useMemo` payload
/// (`{ trip_id, style_hint? }`). `tripID` is the resolved numeric trip id (web `numericTripId`);
/// `styleHint` is the trimmed, non-empty style hint or `nil`. A pure value so the encoding is
/// asserted exactly.
public struct AIPostcardDraftBody: Sendable, Equatable {
    public let tripID: Int
    public let styleHint: String?

    public init(tripID: Int, styleHint: String?) {
        self.tripID = tripID
        self.styleHint = styleHint
    }
}

// MARK: - Draft endpoint (web static URL + `useMemo` body)

/// Builds the propose-only draft request the stream is opened against — the native port of the web
/// surface's static URL (`/ai/share-cards/trip-image/draft`) plus its `useMemo` body. Pure +
/// deterministic so the body shape, the `numericTripId` rule, and the style-hint trimming are
/// asserted.
public enum AIPostcardEndpoint {
    /// The AI feature id this surface is gated by
    /// (web `withAiFeature('trip-postcard-share-card-image-generation', …)`).
    public static let featureID = "trip-postcard-share-card-image-generation"

    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AITripPostcardShareCardImageGeneration"

    /// The static draft path the stream POSTs to (web `useAiStream({ url })`). Unlike the per-trip
    /// name surface, the trip is carried in the body, not the path.
    public static let draftPath = "/ai/share-cards/trip-image/draft"

    /// The resolved numeric trip id — the native port of the web
    /// `numericTripId = (typeof tripId === 'number' && Number.isFinite(tripId)) ? tripId : 0`.
    /// A Swift `Int` is always finite, so the rule reduces to the optional-coalesce; the value flows
    /// into the body verbatim (the `> 0` gate lives in `AIPostcardInput.canStart`).
    public static func numericTripID(_ tripID: Int?) -> Int {
        tripID ?? 0
    }

    /// Builds the draft body — the native port of the web `useMemo`: `trip_id` is always present (the
    /// resolved `numericTripId`), `style_hint` is included only when the trimmed hint is non-empty.
    public static func draftBody(tripID: Int?, styleHint: String?) -> AIPostcardDraftBody {
        let trimmed = styleHint?.trimmingCharacters(in: .whitespacesAndNewlines)
        let hint = (trimmed?.isEmpty == false) ? trimmed : nil
        return AIPostcardDraftBody(tripID: numericTripID(tripID), styleHint: hint)
    }

    /// Serialises the body to the JSON bytes POSTed by the stream driver (web `JSON.stringify(body)`).
    /// Keys are sorted so the bytes are deterministic for the request builder test; `trip_id` is
    /// always emitted, `style_hint` only when present.
    public static func encodedDraftBody(_ body: AIPostcardDraftBody) -> Data {
        var object: [String: Any] = ["trip_id": body.tripID]
        if let hint = body.styleHint {
            object["style_hint"] = hint
        }
        let options: JSONSerialization.WritingOptions = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: options) else {
            return Data("{}".utf8)
        }
        return data
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken content is
/// asserted without rendering the view. The action button reads the universal Helix CTA then the
/// per-feature verb (web `aria-label = "{askHelix} · {buttonLabel}"`); the output reads its role then
/// its content.
public enum AIPostcardAccessibility {
    /// The action button's accessibility label: "{askHelix} · {buttonLabel}" (web aria-label).
    public static func actionLabel(askHelix: String, buttonLabel: String) -> String {
        "\(askHelix) · \(buttonLabel)"
    }

    /// The streamed-draft output label: "{role}: {text}".
    public static func draftLabel(role: String, text: String) -> String {
        "\(role): \(text)"
    }

    /// The error output label: "{errorLabel} {message}" (web "Helix error: {error}").
    public static func errorLabel(prefix: String, message: String) -> String {
        "\(prefix) \(message)"
    }
}
