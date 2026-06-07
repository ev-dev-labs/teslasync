import AppIntents
import Foundation

/// The kinds of report the "Export Report" intent can request. Each maps to the
/// app route where the export is initiated, so the intent stays a thin,
/// permission-respecting entry point into the existing export flow rather than a
/// parallel implementation of it.
public enum ReportKind: String, CaseIterable, Codable, Sendable {
    case charging
    case driving
    case energy
    case battery
    case trips

    /// The route that hosts the export action for this report.
    public var route: AppRoute {
        switch self {
        case .charging: .charging
        case .driving: .driving
        case .energy: .energy
        case .battery: .energy
        case .trips: .trips
        }
    }

    public var systemImage: String {
        switch self {
        case .charging: "bolt.fill"
        case .driving: "speedometer"
        case .energy: "battery.100"
        case .battery: "cross.case.fill"
        case .trips: "map.fill"
        }
    }

    public var titleResource: LocalizedStringResource {
        LocalizedStringResource("intent.report.\(rawValue)")
    }
}

extension ReportKind: AppEnum {
    public static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "intent.report.typeName")
    }

    public static var caseDisplayRepresentations: [ReportKind: DisplayRepresentation] {
        [
            .charging: DisplayRepresentation(title: "intent.report.charging", image: .init(systemName: "bolt.fill")),
            .driving: DisplayRepresentation(title: "intent.report.driving", image: .init(systemName: "speedometer")),
            .energy: DisplayRepresentation(title: "intent.report.energy", image: .init(systemName: "battery.100")),
            .battery: DisplayRepresentation(
                title: "intent.report.battery",
                image: .init(systemName: "cross.case.fill")
            ),
            .trips: DisplayRepresentation(title: "intent.report.trips", image: .init(systemName: "map.fill"))
        ]
    }
}
