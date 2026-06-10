//
//  ImportPreviewModal.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0024 · ImportPreviewModal (Apple)
//
//  The testable, dependency-free projection core for the dashboard import modal — the faithful
//  port of features/dashboard/components/ImportPreviewModal.tsx and the `validateImport`
//  hook (features/dashboard/hooks/validateImport.ts) it binds to. Everything here is pure
//  Foundation so the tab model, the JSON → dashboard validator, the url-safe-base64 decoder, the
//  share-URL param extraction, and the resolved domain values are all unit-tested without a bundle
//  or a rendered view.
//
//  Web parity notes:
//    • `'file' | 'paste' | 'url'` tabs       → `ImportPreviewTab` (label key + web fallback).
//    • `validateImportData(raw)`             → `ImportPreviewValidator.validate` (same parse guards,
//      required-field checks, widget dedupe, registry availability split, layout clamp, dashboard
//      build — the error / warning copy routes through the injected P1/S10 localizer so the native
//      code holds no English literal, while keeping the web wording as the fallback value).
//    • `fromUrlSafeBase64(encoded)`          → `ImportPreviewURLDecoder.fromURLSafeBase64`.
//    • `handleUrlImport(url)` param extract   → `ImportPreviewURLDecoder.extract` (`#import=` hash
//      first, then `?import=` query; the web `new URL()` / `atob` throw arms collapse to `.invalidURL`).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core
/// so the projection's unit tests can reach it.
public enum ImportPreviewModalSurface {
    public static let slug = "ImportPreviewModal"
}

// MARK: - Tabs (web `'file' | 'paste' | 'url'`)

/// The three import-source tabs the modal exposes. The label resolves through the injected P1/S10
/// localizer so the view holds no hardcoded English.
public enum ImportPreviewTab: String, Sendable, Equatable, Hashable, CaseIterable, Identifiable {
    case file
    case paste
    case url

    public var id: String {
        rawValue
    }

    /// The per-tab i18n key (web `import.fromFile` / `import.fromClipboard` / `import.fromUrl`).
    public var labelKey: String {
        switch self {
        case .file: "import.fromFile"
        case .paste: "import.fromClipboard"
        case .url: "import.fromUrl"
        }
    }

    /// The web English fallback label.
    public var labelFallback: String {
        switch self {
        case .file: "From File"
        case .paste: "Paste JSON"
        case .url: "From URL"
        }
    }
}

// MARK: - Domain value types (native parity of SavedDashboard / WidgetInstance / RGLLayout)

/// A placed widget instance — native parity of `WidgetInstance` reduced to the fields the preview
/// reads (`id`, `widgetId`; the opaque `config` is irrelevant to the preview and omitted).
public struct ImportPreviewWidgetInstance: Sendable, Equatable, Identifiable {
    /// The instance id, joined to a layout item (web `widget.id` ↔ `item.i`).
    public let id: String
    /// The registry widget id used for availability + the icon/name lookup (web `widget.widgetId`).
    public let widgetID: String

    public init(id: String, widgetID: String) {
        self.id = id
        self.widgetID = widgetID
    }
}

/// One placed item in a dashboard layout — native parity of an `RGLLayout` reduced to the fields the
/// preview thumbnail reads (web `i`/`x`/`y`/`w`/`h`; the single-letter `i`/`w`/`h` are spelled out
/// here for the lint identifier budget).
public struct ImportPreviewLayoutItem: Sendable, Equatable {
    /// The layout key joined to a widget instance's id (web `i` ↔ `widget.id`).
    public let identifier: String
    /// Column offset in grid units (web `x`).
    public let x: Int
    /// Row offset in grid units (web `y`).
    public let y: Int
    /// Column span in grid units (web `w`).
    public let widthUnits: Int
    /// Row span in grid units (web `h`).
    public let heightUnits: Int

    public init(identifier: String, x: Int, y: Int, widthUnits: Int, heightUnits: Int) {
        self.identifier = identifier
        self.x = x
        self.y = y
        self.widthUnits = widthUnits
        self.heightUnits = heightUnits
    }
}

/// The validated, normalized dashboard — native parity of the `SavedDashboard` the web
/// `validateImportData` builds and hands to `onConfirm`.
public struct ImportPreviewDashboard: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let widgets: [ImportPreviewWidgetInstance]
    public let layouts: [String: [ImportPreviewLayoutItem]]

    public init(
        id: String,
        name: String,
        widgets: [ImportPreviewWidgetInstance],
        layouts: [String: [ImportPreviewLayoutItem]]
    ) {
        self.id = id
        self.name = name
        self.widgets = widgets
        self.layouts = layouts
    }

    /// The layout for a breakpoint, or empty (web `layouts[bp] ?? []`).
    public func layout(for breakpoint: String) -> [ImportPreviewLayoutItem] {
        layouts[breakpoint] ?? []
    }
}

/// The result of validating a raw import — native parity of the `ImportValidation` interface.
public struct ImportPreviewValidation: Sendable, Equatable {
    public let isValid: Bool
    public let errors: [String]
    public let warnings: [String]
    public let dashboard: ImportPreviewDashboard?
    public let missingWidgets: [String]
    public let availableWidgets: [String]

    public init(
        isValid: Bool,
        errors: [String],
        warnings: [String],
        dashboard: ImportPreviewDashboard?,
        missingWidgets: [String],
        availableWidgets: [String]
    ) {
        self.isValid = isValid
        self.errors = errors
        self.warnings = warnings
        self.dashboard = dashboard
        self.missingWidgets = missingWidgets
        self.availableWidgets = availableWidgets
    }
}

// MARK: - Validator (pure port of web `validateImportData`)

/// The dependency-free `validateImportData` port. The registry membership, the message localizer,
/// and the (otherwise time/random-seeded) id generators are injected so the whole pipeline is
/// deterministic under test. Breakpoint columns match the web `{ lg: 4, md: 3, sm: 2, xs: 1 }`.
public enum ImportPreviewValidator {
    /// Web `breakpointCols`.
    static let breakpointColumns: [(bp: String, cols: Int)] = [("lg", 4), ("md", 3), ("sm", 2), ("xs", 1)]

    /// Validates and normalizes raw JSON into a safe dashboard import (web `validateImportData`).
    public static func validate(
        _ raw: String,
        registryIDs: Set<String>,
        localize: (String, String) -> String,
        instanceID: () -> String = { "w-\(UUID().uuidString.prefix(8))" },
        dashboardID: () -> String = { "import-\(UUID().uuidString.prefix(8))" }
    ) -> ImportPreviewValidation {
        guard let object = parseObject(raw) else {
            return invalid([localize("import.validation.invalidJson", "Invalid JSON format")])
        }
        guard case let .dictionary(data) = object else {
            return invalid([localize("import.validation.expectedObject", "Expected a JSON object")])
        }

        let fieldErrors = requiredFieldErrors(data, localize: localize)
        if !fieldErrors.isEmpty {
            return invalid(fieldErrors)
        }

        let widgets = parseWidgets(data["widgets"], instanceID: instanceID)
        let available = widgets.filter { registryIDs.contains($0.widgetID) }
        let missing = widgets.filter { !registryIDs.contains($0.widgetID) }
        var warnings: [String] = []
        if !missing.isEmpty {
            warnings.append(skippedWarning(count: missing.count, localize: localize))
        }
        if available.isEmpty {
            return ImportPreviewValidation(
                isValid: false,
                errors: [localize("import.validation.noCompatible", "No compatible widgets found in this layout")],
                warnings: warnings,
                dashboard: nil,
                missingWidgets: missing.map(\.widgetID),
                availableWidgets: []
            )
        }

        let layouts = sanitizeLayouts(data["layouts"], availableIDs: Set(available.map(\.id)))
        let dashboard = ImportPreviewDashboard(
            id: dashboardID(),
            name: String((data["name"] as? String ?? "").prefix(100)),
            widgets: available,
            layouts: layouts
        )
        return ImportPreviewValidation(
            isValid: true,
            errors: [],
            warnings: warnings,
            dashboard: dashboard,
            missingWidgets: missing.map(\.widgetID),
            availableWidgets: available.map(\.widgetID)
        )
    }

    // MARK: Stages

    /// JSON.parse parity — a top-level object/array/scalar wrapper, or `nil` when the bytes are not
    /// valid JSON (web `try { JSON.parse } catch`).
    private static func parseObject(_ raw: String) -> ParsedJSON? {
        guard let data = raw.data(using: .utf8) else { return nil }
        guard let value = try? JSONSerialization.jsonObject(
            with: data,
            options: [.fragmentsAllowed]
        ) else { return nil }
        if let dictionary = value as? [String: Any] {
            return .dictionary(dictionary)
        }
        return .other
    }

    /// Web step 2 — `name` string, `widgets` array, `layouts` object (collects every miss).
    private static func requiredFieldErrors(
        _ data: [String: Any],
        localize: (String, String) -> String
    ) -> [String] {
        var errors: [String] = []
        if !(data["name"] is String) || (data["name"] as? String)?.isEmpty == true {
            errors.append(localize("import.validation.invalidName", #"Missing or invalid "name" field"#))
        }
        if !(data["widgets"] is [Any]) {
            errors.append(localize("import.validation.invalidWidgets", #"Missing or invalid "widgets" array"#))
        }
        if !(data["layouts"] is [String: Any]) {
            errors.append(localize("import.validation.invalidLayouts", #"Missing or invalid "layouts" object"#))
        }
        return errors
    }

    /// Web step 3 — keep object entries with a string `widgetId`, assigning a unique instance id
    /// (deduping repeats) so a later layout item can join it.
    private static func parseWidgets(_ raw: Any?, instanceID: () -> String) -> [ImportPreviewWidgetInstance] {
        guard let rawWidgets = raw as? [Any] else { return [] }
        var seen = Set<String>()
        var result: [ImportPreviewWidgetInstance] = []
        for entry in rawWidgets {
            guard let widget = entry as? [String: Any], let widgetID = widget["widgetId"] as? String else {
                continue
            }
            var id = widget["id"] as? String ?? instanceID()
            if seen.contains(id) { id = "\(id)-dup-\(instanceID())" }
            seen.insert(id)
            result.append(ImportPreviewWidgetInstance(id: id, widgetID: widgetID))
        }
        return result
    }

    /// Web step 5 — per-breakpoint, keep items whose `i` joins an available widget, clamping the
    /// coordinates into the grid (`x` 0…cols-1, `y` ≥ 0, `w` 1…cols, `h` 1…8).
    private static func sanitizeLayouts(
        _ raw: Any?,
        availableIDs: Set<String>
    ) -> [String: [ImportPreviewLayoutItem]] {
        guard let rawLayouts = raw as? [String: Any] else { return [:] }
        var result: [String: [ImportPreviewLayoutItem]] = [:]
        for (bp, cols) in breakpointColumns {
            guard let rawItems = rawLayouts[bp] as? [Any] else { continue }
            result[bp] = rawItems.compactMap { sanitizeItem($0, cols: cols, availableIDs: availableIDs) }
        }
        return result
    }

    private static func sanitizeItem(
        _ raw: Any,
        cols: Int,
        availableIDs: Set<String>
    ) -> ImportPreviewLayoutItem? {
        guard let item = raw as? [String: Any], let identifier = item["i"] as? String,
              availableIDs.contains(identifier) else { return nil }
        let posX = nonNegative(item["x"]).map { clamp($0, 0, cols - 1) } ?? 0
        let posY = nonNegative(item["y"]) ?? 0
        let width = nonNegative(item["w"]).map { clamp($0, 1, cols) } ?? 1
        let height = nonNegative(item["h"]).map { clamp($0, 1, 8) } ?? 1
        return ImportPreviewLayoutItem(identifier: identifier, x: posX, y: posY, widthUnits: width, heightUnits: height)
    }

    // MARK: Helpers

    private static func skippedWarning(count: Int, localize: (String, String) -> String) -> String {
        localize("import.validation.skipped", "{{count}} widget(s) not available and will be skipped")
            .replacingOccurrences(of: "{{count}}", with: String(count))
    }

    private static func invalid(_ errors: [String]) -> ImportPreviewValidation {
        ImportPreviewValidation(
            isValid: false,
            errors: errors,
            warnings: [],
            dashboard: nil,
            missingWidgets: [],
            availableWidgets: []
        )
    }

    /// Web `isFinitePositive` → a finite, non-negative integer (booleans excluded), else `nil`.
    private static func nonNegative(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.isFinite, double >= 0 else { return nil }
        return Int(double)
    }

    private static func clamp(_ value: Int, _ lower: Int, _ upper: Int) -> Int {
        min(max(value, lower), upper)
    }

    /// A minimal JSON top-level shape so the validator distinguishes an object from an array/scalar
    /// (web `typeof parsed !== 'object' || Array.isArray`).
    private enum ParsedJSON {
        case dictionary([String: Any])
        case other
    }
}

// MARK: - URL decoder (port of web `fromUrlSafeBase64` + `handleUrlImport`)

/// The dependency-free share-URL handling: the url-safe-base64 decode and the `#import=` / `?import=`
/// param extraction. Mirrors the web `handleUrlImport`, whose `new URL()` / `atob` throw arms both
/// resolve to the "Invalid URL format" branch.
public enum ImportPreviewURLDecoder {
    /// The outcome of extracting + decoding a share URL.
    public enum Outcome: Sendable, Equatable {
        /// A decoded JSON payload, ready to validate.
        case json(String)
        /// The URL parsed but carried no `import` param (web `import.noImportParam`).
        case noParam
        /// The URL did not parse, or its payload was not decodable base64 (web `import.invalidUrl`).
        case invalidURL
    }

    /// Extracts the encoded payload (hash first, then query) and decodes it (web `handleUrlImport`).
    public static func extract(_ urlString: String) -> Outcome {
        guard let components = URLComponents(string: urlString), components.scheme != nil else {
            return .invalidURL
        }
        let encoded = hashImport(components.fragment) ?? queryImport(components)
        guard let encoded else { return .noParam }
        guard let json = fromURLSafeBase64(encoded) else { return .invalidURL }
        return .json(json)
    }

    /// Decodes a url-safe base64 string to UTF-8 text, re-adding the stripped `=` padding. Returns
    /// `nil` for malformed base64 or a non-UTF-8 body (web `atob` throw → caught as invalid URL).
    public static func fromURLSafeBase64(_ encoded: String) -> String? {
        var standard = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let remainder = standard.count % 4
        if remainder > 0 { standard.append(String(repeating: "=", count: 4 - remainder)) }
        guard let data = Data(base64Encoded: standard), let text = String(data: data, encoding: .utf8) else {
            return nil
        }
        return text
    }

    /// Web `hash.startsWith('#import=') ? hash.slice(8) : null`. `URLComponents.fragment` already
    /// strips the leading `#`, so the prefix to match is `import=`.
    private static func hashImport(_ fragment: String?) -> String? {
        guard let fragment, fragment.hasPrefix("import=") else { return nil }
        return String(fragment.dropFirst("import=".count))
    }

    /// Web `parsed.searchParams.get('import')`.
    private static func queryImport(_ components: URLComponents) -> String? {
        components.queryItems?.first { $0.name == "import" }?.value
    }
}
