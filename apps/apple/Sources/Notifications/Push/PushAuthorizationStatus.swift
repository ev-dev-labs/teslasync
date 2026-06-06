import Foundation

/// The user's notification-authorization state, projected from the OS
/// (`UNAuthorizationStatus`) into a Shared-free value the coordinator and settings
/// bind to. `provisional` and `ephemeral` are "quietly authorized" — notifications
/// deliver, so they count as authorized for registration purposes.
public enum PushAuthorizationStatus: String, Codable, Equatable, Sendable {
    case notDetermined
    case denied
    case authorized
    case provisional
    case ephemeral

    /// Whether the app may register for and receive remote notifications.
    public var isAuthorized: Bool {
        switch self {
        case .authorized, .provisional, .ephemeral:
            true
        case .notDetermined, .denied:
            false
        }
    }

    /// Whether the system prompt has not yet been shown (the only state from which
    /// requesting authorization can surface the OS dialog).
    public var canPrompt: Bool {
        self == .notDetermined
    }
}
