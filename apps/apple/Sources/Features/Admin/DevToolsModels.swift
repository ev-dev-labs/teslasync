import SwiftUI

// MARK: - Tone (Sendable; maps to the shared `TSTone`)

/// Semantic tone for DevTools icon boxes/badges. A local, `Sendable` mirror of the
/// shared `TSTone` (which, as a public enum, is not implicitly `Sendable`) so the
/// static catalogs below stay concurrency-safe. Resolved to `TSTone` at the view.
public enum DevToolsTone: Sendable {
    case info, success, warning, danger, accent, neutral

    public var tsTone: TSTone {
        switch self {
        case .info: .info
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        case .accent: .accent
        case .neutral: .neutral
        }
    }
}

// MARK: - Tabs (web `DevToolsPage.tsx` TAB_KEYS / TabNav)

/// The five developer-tools sections, mirroring the web page's `TABS` array
/// (`fleet-api`, `telemetry`, `infrastructure`, `utilities`, `reference`) in the
/// same order. Drives the page's segmented navigation; the URL-tab state in the
/// web (`useUrlEnum`) maps to the model's `selectedTab` here.
public enum DevToolsTab: String, CaseIterable, Identifiable, Sendable {
    case fleetAPI = "fleet-api"
    case telemetry
    case infrastructure
    case utilities
    case reference

    public var id: String {
        rawValue
    }

    /// Tab label (web `TABS[].label`).
    public var titleKey: LocalizedStringKey {
        switch self {
        case .fleetAPI: "devtools.tab.fleetApi"
        case .telemetry: "devtools.tab.telemetry"
        case .infrastructure: "devtools.tab.infrastructure"
        case .utilities: "devtools.tab.utilities"
        case .reference: "devtools.tab.reference"
        }
    }

    /// SF Symbol for the tab (web lucide Globe/Radio/Server/Wrench/BookOpen).
    public var systemImage: String {
        switch self {
        case .fleetAPI: "globe"
        case .telemetry: "dot.radiowaves.left.and.right"
        case .infrastructure: "server.rack"
        case .utilities: "wrench.and.screwdriver.fill"
        case .reference: "book.fill"
        }
    }
}

// MARK: - Fleet API: onboarding steps (web `ONBOARDING_STEPS`)

/// One Fleet API onboarding step shown in the Fleet API tab (web `ONBOARDING_STEPS`).
public struct DevToolsOnboardingStep: Identifiable, Sendable {
    public let id: String
    public let titleKey: String
    public let detailKey: String
    public let systemImage: String

    public var title: LocalizedStringKey {
        LocalizedStringKey(titleKey)
    }

    public var detail: LocalizedStringKey {
        LocalizedStringKey(detailKey)
    }

    public init(id: String, titleKey: String, detailKey: String, systemImage: String) {
        self.id = id
        self.titleKey = titleKey
        self.detailKey = detailKey
        self.systemImage = systemImage
    }
}

// MARK: - Fleet API: Tesla endpoint reference (web `TESLA_ENDPOINTS`)

/// A documented Tesla Fleet API endpoint (web `TESLA_ENDPOINTS` / Tesla Api Ref tool).
/// `detail` is a technical reference description rendered verbatim — the web constant and
/// the native `StaticApiEndpointCatalog` precedent both treat endpoint summaries as data.
public struct DevToolsTeslaEndpoint: Identifiable, Sendable {
    public let method: String
    public let path: String
    public let detail: String
    public let searchText: String

    public var id: String {
        "\(method) \(path)"
    }

    public init(method: String, path: String, detail: String) {
        self.method = method
        self.path = path
        self.detail = detail
        searchText = "\(method) \(path) \(detail)".lowercased()
    }
}

// MARK: - Telemetry: signal-field reference (web `TELEMETRY_FIELDS`)

/// A category of Fleet Telemetry signal fields (web `TELEMETRY_FIELDS[]`). The field
/// names are Tesla proto identifiers and are rendered verbatim (never localized).
public struct DevToolsTelemetryCategory: Identifiable, Sendable {
    public let id: String
    public let nameKey: String
    public let fields: [String]

    public var name: LocalizedStringKey {
        LocalizedStringKey(nameKey)
    }

    public var fieldCount: Int {
        fields.count
    }

    public init(id: String, nameKey: String, fields: [String]) {
        self.id = id
        self.nameKey = nameKey
        self.fields = fields
    }
}

// MARK: - Infrastructure: diagnostics tool catalog (web `InfrastructureSection`)

/// A backend diagnostics tool descriptor (web `InfrastructureSection` BackendTool/MqttTest).
/// The native hub presents the catalog; the live request paths belong to other units.
public struct DevToolsInfraTool: Identifiable, Sendable {
    public let id: String
    public let nameKey: String
    public let detailKey: String
    public let endpoint: String
    public let method: String
    public let systemImage: String
    public let tone: DevToolsTone

    public var name: LocalizedStringKey {
        LocalizedStringKey(nameKey)
    }

    public var detail: LocalizedStringKey {
        LocalizedStringKey(detailKey)
    }

    public init(
        id: String,
        nameKey: String,
        detailKey: String,
        endpoint: String,
        method: String,
        systemImage: String,
        tone: DevToolsTone
    ) {
        self.id = id
        self.nameKey = nameKey
        self.detailKey = detailKey
        self.endpoint = endpoint
        self.method = method
        self.systemImage = systemImage
        self.tone = tone
    }
}

// MARK: - Utilities: client-side tool registry (web `useToolList`)

/// A client-side utility tool entry (web `useToolList()`), driving the searchable grid.
/// `searchText` is the English name+description used for the in-memory filter (web
/// filters on the resolved `t()` strings); display uses the localized keys.
public struct DevToolsUtilityTool: Identifiable, Sendable {
    public let id: String
    public let nameKey: String
    public let detailKey: String
    public let systemImage: String
    public let tone: DevToolsTone
    public let searchText: String

    public var name: LocalizedStringKey {
        LocalizedStringKey(nameKey)
    }

    public var detail: LocalizedStringKey {
        LocalizedStringKey(detailKey)
    }

    public init(
        id: String,
        nameKey: String,
        detailKey: String,
        systemImage: String,
        tone: DevToolsTone,
        searchText: String
    ) {
        self.id = id
        self.nameKey = nameKey
        self.detailKey = detailKey
        self.systemImage = systemImage
        self.tone = tone
        self.searchText = searchText
    }
}

// MARK: - Reference links (web `REFERENCE_LINKS`)

/// An external documentation link (web `REFERENCE_LINKS`).
public struct DevToolsReferenceLink: Identifiable, Sendable {
    public let id: String
    public let titleKey: String
    public let urlString: String
    public let systemImage: String

    public var title: LocalizedStringKey {
        LocalizedStringKey(titleKey)
    }

    public var url: URL? {
        URL(string: urlString)
    }

    public init(id: String, titleKey: String, urlString: String, systemImage: String) {
        self.id = id
        self.titleKey = titleKey
        self.urlString = urlString
        self.systemImage = systemImage
    }
}
