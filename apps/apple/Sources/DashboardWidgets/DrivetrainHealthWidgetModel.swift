import Foundation

// MARK: - Registry metadata

/// Static registry metadata for a dashboard widget, mirroring the web `WidgetDef`
/// registry entry. Keeps the native grid in lockstep with
/// `web/src/features/dashboard/widgets/registry`. String fields hold i18n catalog
/// keys (resolved at the render boundary), so the descriptor stays a pure,
/// testable value type.
public struct DrivetrainHealthWidgetDescriptor: Equatable, Sendable {
    public let id: String
    public let displayNameKey: String
    public let descriptionKey: String
    public let category: String
    public let defaultSize: DashboardWidgetSize
    public let minSize: DashboardWidgetSize
    public let maxSize: DashboardWidgetSize

    public init(
        id: String,
        displayNameKey: String,
        descriptionKey: String,
        category: String,
        defaultSize: DashboardWidgetSize,
        minSize: DashboardWidgetSize,
        maxSize: DashboardWidgetSize
    ) {
        self.id = id
        self.displayNameKey = displayNameKey
        self.descriptionKey = descriptionKey
        self.category = category
        self.defaultSize = defaultSize
        self.minSize = minSize
        self.maxSize = maxSize
    }
}

// MARK: - i18n keys

/// Catalog keys for the surface — the native mirror of the web `t()` calls. Held
/// as constants so the registry, the view, and the tests reference one source of
/// truth (and a test can assert each has a matching catalog entry).
public enum DrivetrainHealthStrings {
    public static let title = "widget.drivetrainHealth.title"
    public static let displayName = "widget.drivetrainHealth.displayName"
    public static let description = "widget.drivetrainHealth.description"
    public static let score = "widget.drivetrainHealth.score"
    public static let motorTemp = "widget.drivetrainHealth.motorTemp"
    public static let statorTemp = "widget.drivetrainHealth.statorTemp"
    public static let inverterHealth = "widget.drivetrainHealth.inverterHealth"
    public static let driveState = "widget.drivetrainHealth.driveState"
    public static let noData = "widget.drivetrainHealth.noData"
    public static let refreshAccessibility = "widget.drivetrainHealth.accessibility.refresh"
}

// MARK: - Display units

/// Temperature display unit applied at the render boundary (web `convertTempFromSI`
/// + `unitPrefs.temperature`). Disk/API values are always SI Celsius.
public enum DrivetrainTemperatureUnit: String, Equatable, Sendable {
    case celsius
    case fahrenheit

    public var symbol: String {
        switch self {
        case .celsius: "°C"
        case .fahrenheit: "°F"
        }
    }

    /// Converts an SI Celsius value into the display unit.
    public func convert(_ celsiusValue: Double) -> Double {
        switch self {
        case .celsius: celsiusValue
        case .fahrenheit: celsiusValue * 9 / 5 + 32
        }
    }
}

// MARK: - API readings

/// Drivetrain-health endpoint payload — the native mirror of the web
/// `DrivetrainHealthData` (camelCase JSON, web `useDrivetrainHealth`).
public struct DrivetrainHealthReading: Decodable, Equatable, Sendable {
    public let frontMotorTempC: Double?
    public let rearMotorTempC: Double?
    public let inverterTempC: Double?
    public let batteryTempC: Double?
    public let motorStatus: String?
    public let overallHealth: String?

    public init(
        frontMotorTempC: Double? = nil,
        rearMotorTempC: Double? = nil,
        inverterTempC: Double? = nil,
        batteryTempC: Double? = nil,
        motorStatus: String? = nil,
        overallHealth: String? = nil
    ) {
        self.frontMotorTempC = frontMotorTempC
        self.rearMotorTempC = rearMotorTempC
        self.inverterTempC = inverterTempC
        self.batteryTempC = batteryTempC
        self.motorStatus = motorStatus
        self.overallHealth = overallHealth
    }
}

/// Motor-latest endpoint payload — the native mirror of the fields the web widget
/// reads from `useMotorLatest` (snake_case JSON).
public struct DrivetrainMotorReading: Decodable, Equatable, Sendable {
    public let motorTempCFront: Double?
    public let diStatorTemp: Double?
    public let inverterTempC: Double?
    public let stateFront: String?

    private enum CodingKeys: String, CodingKey {
        case motorTempCFront = "motor_temp_c_front"
        case diStatorTemp = "di_stator_temp"
        case inverterTempC = "inverter_temp_c"
        case stateFront = "state_front"
    }

    public init(
        motorTempCFront: Double? = nil,
        diStatorTemp: Double? = nil,
        inverterTempC: Double? = nil,
        stateFront: String? = nil
    ) {
        self.motorTempCFront = motorTempCFront
        self.diStatorTemp = diStatorTemp
        self.inverterTempC = inverterTempC
        self.stateFront = stateFront
    }
}

// MARK: - Domain logic

/// Overall powertrain status (web `overallHealth`). Drives the gauge score and
/// color exactly as the web `healthScore` / `healthColor` helpers do.
public enum DrivetrainHealthStatus: String, Equatable, Sendable {
    case good
    case warning
    case critical
    case unknown

    public init(overallHealth: String?) {
        switch overallHealth {
        case "good": self = .good
        case "warning": self = .warning
        case "critical": self = .critical
        default: self = .unknown
        }
    }

    /// Web `healthScore`: good→95, warning→60, critical→25, otherwise 0.
    public var score: Int {
        switch self {
        case .good: 95
        case .warning: 60
        case .critical: 25
        case .unknown: 0
        }
    }

    /// Web `healthColor`: score ≥ 80 success, ≥ 50 warning, else danger.
    public static func tone(forScore score: Int) -> TSTone {
        if score >= 80 { return .success }
        if score >= 50 { return .warning }
        return .danger
    }
}

/// Composed projection of the two feeds into the values the widget renders. The
/// fallback precedence reproduces the web source line-for-line.
public struct DrivetrainHealthProjection: Equatable, Sendable {
    public let health: DrivetrainHealthReading?
    public let motor: DrivetrainMotorReading?

    public init(health: DrivetrainHealthReading?, motor: DrivetrainMotorReading?) {
        self.health = health
        self.motor = motor
    }

    public var status: DrivetrainHealthStatus {
        DrivetrainHealthStatus(overallHealth: health?.overallHealth)
    }

    public var score: Int {
        status.score
    }

    public var tone: TSTone {
        DrivetrainHealthStatus.tone(forScore: score)
    }

    /// web: `health?.frontMotorTempC ?? motor?.motor_temp_c_front ?? null`
    public var motorTempC: Double? {
        health?.frontMotorTempC ?? motor?.motorTempCFront
    }

    /// web: `motor?.di_stator_temp ?? health?.rearMotorTempC ?? null`
    public var statorTempC: Double? {
        motor?.diStatorTemp ?? health?.rearMotorTempC
    }

    /// web: `health?.inverterTempC ?? motor?.inverter_temp_c ?? null`
    public var inverterTempC: Double? {
        health?.inverterTempC ?? motor?.inverterTempC
    }

    /// web: `motor?.state_front ?? health?.motorStatus ?? '—'`
    public var driveState: String {
        motor?.stateFront ?? health?.motorStatus ?? "—"
    }

    /// web: `hasData = !!health || !!motor`
    public var hasData: Bool {
        health != nil || motor != nil
    }
}

/// Pure JSON → projection decoding. Lives in the Shared-free surface so it is
/// host-testable; the production live provider feeds it the raw feed payloads.
public enum DrivetrainHealthDecoder {
    public static func reading(from data: Data?) -> DrivetrainHealthReading? {
        decode(DrivetrainHealthReading.self, from: data)
    }

    public static func motor(from data: Data?) -> DrivetrainMotorReading? {
        decode(DrivetrainMotorReading.self, from: data)
    }

    public static func projection(healthJSON: Data?, motorJSON: Data?) -> DrivetrainHealthProjection {
        DrivetrainHealthProjection(health: reading(from: healthJSON), motor: motor(from: motorJSON))
    }

    private static func decode<T: Decodable>(_: T.Type, from data: Data?) -> T? {
        guard let data, !data.isEmpty else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}

/// Display formatting for a temperature stat (web `fmtNumber(value, 0)` with an
/// em dash fallback when the value is absent).
public enum DrivetrainHealthFormat {
    public static func temperature(_ celsiusValue: Double?, unit: DrivetrainTemperatureUnit) -> String {
        guard let celsiusValue else { return "—" }
        return String(Int(unit.convert(celsiusValue).rounded()))
    }
}

/// One stat row under the gauge (web `GaugeHeroStat`).
public struct DrivetrainStat: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let value: String
    public let unit: String?

    public init(id: String, labelKey: String, value: String, unit: String?) {
        self.id = id
        self.labelKey = labelKey
        self.value = value
        self.unit = unit
    }
}

/// Builds the four stats the web widget renders, in the same order, with the same
/// unit handling (temperatures carry the unit symbol; drive state does not).
public func drivetrainStats(
    _ projection: DrivetrainHealthProjection,
    unit: DrivetrainTemperatureUnit
) -> [DrivetrainStat] {
    let symbol = unit.symbol
    return [
        DrivetrainStat(
            id: "motorTemp",
            labelKey: DrivetrainHealthStrings.motorTemp,
            value: DrivetrainHealthFormat.temperature(projection.motorTempC, unit: unit),
            unit: symbol
        ),
        DrivetrainStat(
            id: "statorTemp",
            labelKey: DrivetrainHealthStrings.statorTemp,
            value: DrivetrainHealthFormat.temperature(projection.statorTempC, unit: unit),
            unit: symbol
        ),
        DrivetrainStat(
            id: "inverter",
            labelKey: DrivetrainHealthStrings.inverterHealth,
            value: DrivetrainHealthFormat.temperature(projection.inverterTempC, unit: unit),
            unit: symbol
        ),
        DrivetrainStat(
            id: "driveState",
            labelKey: DrivetrainHealthStrings.driveState,
            value: projection.driveState,
            unit: nil
        )
    ]
}
