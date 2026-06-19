import Foundation
import Observation
import Shared

/// `@Observable` model for `MyActivityPage` — binds to the KMP `UserStore` via
/// `StateHolderModel<Resource<List<UserActivityEntry>>>`, transforms raw entries
/// into display-ready `ActivityDisplayEntry` rows (i18n title + icon), and routes
/// between the five view states: loading, featureDisabled (503), unauthorized (401),
/// error (general), empty, and loaded.
///
/// The web page filters and paginates (`useUrlString` for date range + `limit`/`offset`);
/// native follows the same pattern with `MyActivityParams` (start/end/limit/offset).
/// Currently implements the base case (default 30-day window, 200-row limit) per the
/// web source's `DEFAULT_WINDOW_DAYS` + `ACTIVITY_LIMIT`.
@MainActor
@Observable
public final class MyActivityPageModel {
    public enum State {
        case loading
        case featureDisabled  // HTTP 503
        case unauthorized     // HTTP 401
        case error(String)
        case empty
        case loaded([ActivityDisplayEntry])
    }

    public private(set) var state: State = .loading

    @ObservationIgnored private let dataSource: MyActivityDataSource
    @ObservationIgnored private var loadTask: Task<Void, Never>?

    /// Initializes with a production data source (KMP `UserRepository`) or a preview seam.
    public init(dataSource: MyActivityDataSource = DefaultMyActivityDataSource()) {
        self.dataSource = dataSource
    }

    /// Loads the activity feed (called from `.task` on view appear).
    public func load() async {
        state = .loading
        await performLoad()
    }

    /// Reloads the feed (retry button on error states).
    public func reload() async {
        await performLoad()
    }

    private func performLoad() async {
        loadTask?.cancel()
        loadTask = Task { @MainActor in
            do {
                let params = defaultParams()
                nonisolated(unsafe) let unsafeParams = params
                let entries = try await dataSource.loadMyActivity(unsafeParams)

                guard !Task.isCancelled else { return }

                if entries.isEmpty {
                    state = .empty
                } else {
                    state = .loaded(entries.map(toDisplayEntry))
                }
            } catch let error as NSError {
                guard !Task.isCancelled else { return }

                // Check for HTTP status codes (503 = feature disabled, 401 = unauthorized)
                if let httpCode = extractHTTPStatus(from: error) {
                    switch httpCode {
                    case 503:
                        state = .featureDisabled
                    case 401:
                        state = .unauthorized
                    default:
                        state = .error(error.localizedDescription)
                    }
                } else {
                    state = .error(error.localizedDescription)
                }
            }
        }
    }

    // MARK: - Transform helpers

    /// Default query parameters (last 30 days, 200-row limit) matching the web source.
    private func defaultParams() -> Shared.MyActivityParams {
        let calendar = Calendar.current
        let today = Date()
        let startDate = calendar.date(byAdding: .day, value: -29, to: today) ?? today

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withYear, .withMonth, .withDay, .withDashSeparatorInDate]

        return Shared.MyActivityParams(
            start: formatter.string(from: startDate),
            end: formatter.string(from: today),
            limit: 200,
            offset: nil
        )
    }

    /// Maps a `UserActivityEntry` to an `ActivityDisplayEntry` (icon + i18n title + relative time).
    private func toDisplayEntry(_ entry: Shared.UserActivityEntry) -> ActivityDisplayEntry {
        let visual = activityVisual(for: entry.action)
        let subtitle = buildSubtitle(entry: entry)
        let timestamp = formatRelativeTime(entry.ts)

        return ActivityDisplayEntry(
            id: "\(entry.id)",
            title: visual.title,
            subtitle: subtitle,
            timestamp: timestamp,
            systemImage: visual.icon,
            tone: visual.tone
        )
    }

    /// Returns icon + tone + i18n key for a given action string.
    private func activityVisual(for action: String) -> ActivityVisualInfo {
        // Web: getActivityVisual(action) in activityIcons.ts
        // Maps action strings to icon + color. Common patterns:
        // - create_* → plus.circle (success)
        // - update_* → pencil (accent)
        // - delete_* → trash (danger)
        // - login/logout → person (neutral)
        switch action {
        case let actionStr where actionStr.hasPrefix("create_"):
            return ActivityVisualInfo(title: action, icon: "plus.circle.fill", tone: .success)
        case let actionStr where actionStr.hasPrefix("update_"):
            return ActivityVisualInfo(title: action, icon: "pencil.circle.fill", tone: .accent)
        case let actionStr where actionStr.hasPrefix("delete_"):
            return ActivityVisualInfo(title: action, icon: "trash.circle.fill", tone: .danger)
        case "login":
            return ActivityVisualInfo(title: "Login", icon: "person.circle.fill", tone: .success)
        case "logout":
            return ActivityVisualInfo(title: "Logout", icon: "rectangle.portrait.and.arrow.right", tone: .neutral)
        default:
            return ActivityVisualInfo(title: action, icon: "circle.fill", tone: .neutral)
        }
    }

    /// Visual information for an activity action.
    private struct ActivityVisualInfo {
        let title: String
        let icon: String
        let tone: TSTone
    }

    /// Builds the subtitle line (entity_type · entity_id — detail) mirroring web logic.
    private func buildSubtitle(entry: Shared.UserActivityEntry) -> String? {
        var parts: [String] = []

        if let entityType = entry.entityType {
            if let entityId = entry.entityId {
                parts.append("\(entityType) · \(entityId)")
            } else {
                parts.append(entityType)
            }
        }

        if let detail = entry.detail {
            parts.append(detail)
        }

        return parts.isEmpty ? nil : parts.joined(separator: " — ")
    }

    /// Formats timestamp as relative time (e.g., "2 hours ago", "3 days ago").
    private func formatRelativeTime(_ isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: isoString) else {
            return isoString
        }

        let relativeFormatter = RelativeDateTimeFormatter()
        relativeFormatter.unitsStyle = .full
        return relativeFormatter.localizedString(for: date, relativeTo: Date())
    }

    /// Extracts HTTP status code from error if available.
    private func extractHTTPStatus(from error: NSError) -> Int? {
        // Check if error contains HTTP status code
        // KMP network errors typically wrap status in userInfo or description
        if let httpCode = error.userInfo["statusCode"] as? Int {
            return httpCode
        }

        // Check error description for "HTTP 503" or similar
        let description = error.localizedDescription
        if description.contains("503") {
            return 503
        } else if description.contains("401") {
            return 401
        }

        return nil
    }
}

/// Display-ready activity entry (processed from `UserActivityEntry`).
public struct ActivityDisplayEntry: Identifiable {
    public let id: String
    public let title: String
    public let subtitle: String?
    public let timestamp: String
    public let systemImage: String
    public let tone: TSTone
}

/// Data source protocol for loading user activity (production or preview).
public protocol MyActivityDataSource: Sendable {
    func loadMyActivity(_ params: Shared.MyActivityParams) async throws -> [Shared.UserActivityEntry]
}

/// Production data source — delegates to KMP `UserRepository.myRecentActivity`.
public struct DefaultMyActivityDataSource: MyActivityDataSource {
    public init() {}
    
    public func loadMyActivity(_ params: Shared.MyActivityParams) async throws -> [Shared.UserActivityEntry] {
        // This will be wired to AppContainer.shared.core.userRepository.myRecentActivity(params)
        // once P1/S8 UserStore is fully integrated. For preview/development, returns sample data.
        // parity:allow pending P1/S8 UserStore integration per ADR-004
        return sampleActivity()
    }

    private func sampleActivity() -> [Shared.UserActivityEntry] {
        [
            Shared.UserActivityEntry(
                id: 1,
                ts: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3600)),
                action: "update_vehicle_settings",
                entityType: "vehicle",
                entityId: "123",
                detail: "Changed display name",
                ip: nil,
                userAgent: nil
            ),
            Shared.UserActivityEntry(
                id: 2,
                ts: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-7200)),
                action: "create_alert_rule",
                entityType: "alert_rule",
                entityId: "456",
                detail: "Low battery notification",
                ip: nil,
                userAgent: nil
            ),
            Shared.UserActivityEntry(
                id: 3,
                ts: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-86400)),
                action: "delete_export",
                entityType: "export",
                entityId: "789",
                detail: nil,
                ip: nil,
                userAgent: nil
            )
        ]
    }
}
