//
//  DataTable.CSV.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The Foundation-only CSV serializer + the i18next interpolation for the data table — the native peers of
//  the web `lib/csvExport` (`toCSV` / `defaultExportFilename`) the table calls from `handleExportCsv`, and the
//  i18next `{{token}}` substitution the resolved strings use. Pure functions, no SwiftUI, no clock except the
//  explicitly-injected date for the default filename — so the RFC-4180 quoting, the header derivation, and the
//  date-stamped fallback name are all unit-testable in isolation.
//

import Foundation

// MARK: - DataTableInterpolation (web i18next `{{token}}`)

/// Replaces `{{token}}` markers in a resolved template with the supplied values — the native port of i18next
/// interpolation, so the per-surface strings keep a translator-friendly `{{col}}` / `{{count}}` shape (web
/// `t(key, default, { col })`).
public enum DataTableInterpolation {
    /// Substitutes every `{{key}}` occurrence with its value (idempotent for keys absent from `values`).
    public static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }
}

// MARK: - DataTableCSV (web `lib/csvExport`)

/// The CSV serializer — the native peer of the web `toCSV` + `defaultExportFilename`. It joins the supplied
/// header labels and per-row cell strings into an RFC-4180 document (CRLF line breaks; a field is quoted when
/// it contains a comma, quote, CR, or LF, and embedded quotes are doubled), exactly as `lib/csvExport`
/// escapes cells before download. The data table passes the CURRENTLY-VISIBLE columns' headers and each row's
/// `csvValue` output (the native peer of the web "generated from the currently visible columns and the
/// currently sorted/filtered data" contract).
public enum DataTableCSV {
    /// The RFC-4180 record separator (web `toCSV` joins rows with `\r\n`).
    public static let lineBreak = "\r\n"

    /// Quotes a single field when required and doubles embedded quotes — the verbatim port of the web
    /// `escapeCsvCell`: a field containing `,` `"` `\r` or `\n` is wrapped in quotes with `"` → `""`.
    public static func escape(_ field: String) -> String {
        let needsQuoting = field.contains(",")
            || field.contains("\"")
            || field.contains("\n")
            || field.contains("\r")
        guard needsQuoting else { return field }
        let doubled = field.replacingOccurrences(of: "\"", with: "\"\"")
        return "\"\(doubled)\""
    }

    /// Joins one record's already-stringified cells into an escaped CSV line (web one `row.map(escape).join(',')`).
    public static func record(_ cells: [String]) -> String {
        cells.map(escape).joined(separator: ",")
    }

    /// Encodes a full document: the header row followed by each data row — the native peer of the web `toCSV`
    /// output. `rows` are pre-flattened cell strings (the table maps each visible column's `csvValue` over the
    /// source rows before calling this), so the serializer stays free of the generic `Row` type.
    public static func encode(headers: [String], rows: [[String]]) -> String {
        var lines = [record(headers)]
        for row in rows {
            lines.append(record(row))
        }
        return lines.joined(separator: lineBreak)
    }

    /// The date-stamped fallback file name (without extension) — the native peer of the web
    /// `defaultExportFilename(base)` → `"{base}-YYYY-MM-DD"`. The date is injected (UTC `yyyy-MM-dd`) so the
    /// result is deterministic under test.
    public static func defaultFilename(base: String, date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        let safeBase = base.isEmpty ? "table" : base
        return "\(safeBase)-\(formatter.string(from: date))"
    }
}
