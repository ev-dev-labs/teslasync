import Foundation

// MARK: - Static reference tables (web devtools `constants.ts`)

/// Lookup tables backing the client-side utility tools — the native equivalent of the
/// web `constants.ts` maps (VIN decode, byte units, Unix permission bits, HTTP codes).
/// Pure data; values are technical reference tokens rendered verbatim.
public enum DevToolsReferenceData {
    // MARK: VIN decode maps (web `VIN_MANUFACTURERS` / `VIN_MODELS` / …)

    public static let vinManufacturers: [String: String] = [
        "5YJ": "Tesla (USA)",
        "LRW": "Tesla (China)",
        "7SA": "Tesla (EU/Berlin)",
        "XP7": "Tesla (USA)"
    ]

    public static let vinModels: [String: String] = [
        "S": "Model S",
        "3": "Model 3",
        "X": "Model X",
        "Y": "Model Y"
    ]

    public static let vinDrive: [String: String] = [
        "1": "Single Motor RWD",
        "2": "Dual Motor AWD",
        "3": "Performance AWD",
        "4": "Single Motor RWD (LFP)",
        "A": "Dual Motor AWD",
        "B": "Dual Motor AWD",
        "F": "Performance AWD",
        "P": "Performance",
        "E": "Dual Motor",
        "N": "Dual Motor"
    ]

    public static let vinYear: [String: String] = [
        "H": "2017",
        "J": "2018",
        "K": "2019",
        "L": "2020",
        "M": "2021",
        "N": "2022",
        "P": "2023",
        "R": "2024",
        "S": "2025",
        "T": "2026"
    ]

    public static let vinPlant: [String: String] = [
        "F": "Fremont, CA",
        "A": "Austin, TX",
        "B": "Berlin, Germany",
        "C": "Shanghai, China",
        "G": "Gigafactory",
        "E": "Palo Alto, CA"
    ]

    // MARK: Byte units (web `BYTE_UNITS`)

    public static let byteUnits: [String] = ["B", "KB", "MB", "GB", "TB"]

    // MARK: Unix permission bits (web `PERMS`)

    public static let permissionBits: [String: String] = [
        "7": "rwx",
        "6": "rw-",
        "5": "r-x",
        "4": "r--",
        "3": "-wx",
        "2": "-w-",
        "1": "--x",
        "0": "---"
    ]

    // MARK: HTTP status codes (web `HTTP_CODES`)

    /// One HTTP status reference row (web `HTTP_CODES[]`). `text` is the standard reason
    /// phrase and `detail` a short explanation — both technical reference, rendered verbatim.
    public struct HTTPCode: Identifiable, Equatable, Sendable {
        public let code: Int
        public let text: String
        public let detail: String

        public var id: Int {
            code
        }

        public init(code: Int, text: String, detail: String) {
            self.code = code
            self.text = text
            self.detail = detail
        }
    }

    public static let httpCodes: [HTTPCode] = [
        HTTPCode(code: 200, text: "OK", detail: "Request succeeded"),
        HTTPCode(code: 201, text: "Created", detail: "Resource created"),
        HTTPCode(code: 204, text: "No Content", detail: "Success with no body"),
        HTTPCode(code: 301, text: "Moved Permanently", detail: "Resource moved"),
        HTTPCode(code: 302, text: "Found", detail: "Temporary redirect"),
        HTTPCode(code: 304, text: "Not Modified", detail: "Use cached version"),
        HTTPCode(code: 400, text: "Bad Request", detail: "Invalid request"),
        HTTPCode(code: 401, text: "Unauthorized", detail: "Auth required"),
        HTTPCode(code: 403, text: "Forbidden", detail: "Access denied"),
        HTTPCode(code: 404, text: "Not Found", detail: "Resource not found"),
        HTTPCode(code: 405, text: "Method Not Allowed", detail: "HTTP method not supported"),
        HTTPCode(code: 408, text: "Request Timeout", detail: "Client took too long"),
        HTTPCode(code: 409, text: "Conflict", detail: "Resource conflict"),
        HTTPCode(code: 422, text: "Unprocessable Entity", detail: "Validation failed"),
        HTTPCode(code: 429, text: "Too Many Requests", detail: "Rate limited"),
        HTTPCode(code: 500, text: "Internal Server Error", detail: "Server error"),
        HTTPCode(code: 502, text: "Bad Gateway", detail: "Upstream error"),
        HTTPCode(code: 503, text: "Service Unavailable", detail: "Server overloaded"),
        HTTPCode(code: 504, text: "Gateway Timeout", detail: "Upstream timeout")
    ]

    /// Filters the HTTP code table by code/reason/description (web `HttpStatusTool` search).
    public static func filterHTTPCodes(_ query: String) -> [HTTPCode] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return httpCodes }
        return httpCodes.filter {
            String($0.code).contains(trimmed)
                || $0.text.lowercased().contains(trimmed)
                || $0.detail.lowercased().contains(trimmed)
        }
    }
}
