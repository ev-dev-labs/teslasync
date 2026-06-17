//
//  TeslaAccountPageViews.swift
//  TeslaSync — P7 System · TeslaAccountPage (Apple) — View Components
//
//  Extracted views and utilities to keep TeslaAccountPage.swift under 400 lines.
//

import SwiftUI
import Foundation

// MARK: - Date Formatting Utilities

extension TeslaAccountPage {
    /// Formats an ISO8601 timestamp to "MMM d, yyyy 'at' h:mm a" (e.g., "Jun 17, 2026 at 9:30 AM").
    func formatDateTime(_ isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: isoString) else { return isoString }

        let displayFormatter = DateFormatter()
        displayFormatter.dateFormat = "MMM d, yyyy 'at' h:mm a"
        return displayFormatter.string(from: date)
    }

    /// Formats an ISO8601 timestamp to relative time (e.g., "2 minutes ago", "3 hours ago").
    func formatRelative(_ isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: isoString) else { return isoString }

        let now = Date()
        let interval = now.timeIntervalSince(date)

        if interval < 60 {
            return "just now"
        } else if interval < 3600 {
            let minutes = Int(interval / 60)
            return "\(minutes) minute\(minutes == 1 ? "" : "s") ago"
        } else if interval < 86400 {
            let hours = Int(interval / 3600)
            return "\(hours) hour\(hours == 1 ? "" : "s") ago"
        } else {
            let days = Int(interval / 86400)
            return "\(days) day\(days == 1 ? "" : "s") ago"
        }
    }
}

// MARK: - TSSpacing extension

/// Extended spacing tokens used by TeslaAccountPage.
extension TSSpacing {
    static let x2xl: CGFloat = 24
}
