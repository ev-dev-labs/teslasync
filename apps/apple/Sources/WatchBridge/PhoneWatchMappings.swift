import Foundation

#if os(iOS)

    /// Maps the lean watch settings mirror out of the phone's full `AppSettings`.
    public extension WatchSyncSettings {
        init(from settings: AppSettings) {
            self.init(
                measurementSystem: settings.measurementSystem,
                notificationsEnabled: settings.notificationsEnabled,
                appLockEnabled: settings.biometricUnlockEnabled,
                offlineCacheEnabled: settings.offlineCacheEnabled
            )
        }
    }

    /// Maps a relayed watch action onto the phone's authoritative command kind.
    /// Companion-local actions (refresh, open app) have no vehicle command.
    public extension WatchQuickAction {
        var vehicleCommandKind: VehicleCommandKind? {
            switch self {
            case .wake: .wake
            case .climateOn: .climateOn
            case .lockDoors: .lockDoors
            case .flashLights: .flashLights
            case .refresh, .openOnPhone: nil
            }
        }
    }

    public enum PhoneWatchCommandBridge {
        /// Builds a `PhoneWatchSyncService.CommandHandler` from the app's
        /// authenticated command executor + permission gate, so a relayed watch
        /// action runs through the exact same authority as an in-app command.
        public static func handler(
            commanding: any VehicleCommanding,
            isAuthenticated: @escaping @MainActor () -> Bool,
            permitted: @escaping @MainActor () -> Set<VehicleCommandKind> = { [] }
        ) -> PhoneWatchSyncService.CommandHandler {
            { request in
                guard let kind = request.action.vehicleCommandKind else {
                    return WatchCommandResult(
                        requestID: request.id,
                        success: false,
                        outcomeKey: VehicleCommandOutcome.unavailable.messageKey
                    )
                }
                let decision = VehicleCommandGate.evaluate(
                    kind,
                    isAuthenticated: isAuthenticated(),
                    permitted: permitted()
                )
                switch decision {
                case .needsAuthentication:
                    return WatchCommandResult(
                        requestID: request.id,
                        success: false,
                        outcomeKey: VehicleCommandOutcome.needsAuthentication.messageKey
                    )
                case .notPermitted:
                    return WatchCommandResult(
                        requestID: request.id,
                        success: false,
                        outcomeKey: VehicleCommandOutcome.notPermitted.messageKey
                    )
                case .allowed:
                    let outcome = await commanding.perform(VehicleCommandRequest(kind: kind))
                    let success = switch outcome {
                    case .started, .success: true
                    case .needsAuthentication, .notPermitted, .unavailable, .failed: false
                    }
                    return WatchCommandResult(requestID: request.id, success: success, outcomeKey: outcome.messageKey)
                }
            }
        }
    }

#endif
