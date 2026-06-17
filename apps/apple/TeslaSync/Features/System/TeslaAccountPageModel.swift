//
//  TeslaAccountPageModel.swift
//  TeslaSync — P7 System · TeslaAccountPage (Apple) — View Model
//
//  @Observable model for TeslaAccountPage. Fetches Tesla user profile via KMP core,
//  implements loading/empty/error/success states, and exposes refresh capability.
//  Binding contract: GET /tesla/user/profile, POST /tesla/user/profile/refresh.
//

import SwiftUI
import Observation
import Foundation

// MARK: - Data Models

/// The Tesla user profile from the Fleet API (mirrors `TeslaUserProfile` from web/src/api/hooks/useUser.ts).
struct TeslaUserProfile: Identifiable, Codable {
    let id: Int
    let email: String
    let fullName: String
    let profileImageUrl: String?
    let fetchedAt: String
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case email
        case fullName = "full_name"
        case profileImageUrl = "profile_image_url"
        case fetchedAt = "fetched_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// The API response envelope for /tesla/user/profile.
struct TeslaProfileEnvelope: Codable {
    let profile: TeslaUserProfile?
    let fetchedAt: String?

    enum CodingKeys: String, CodingKey {
        case profile
        case fetchedAt = "fetched_at"
    }
}

/// The view model state.
enum TeslaAccountState {
    case loading
    case empty
    case error(String)
    case success(TeslaUserProfile, fetchedAt: String?)
}

// MARK: - ViewModel

/// The @Observable model for TeslaAccountPage. Fetches profile data on load, exposes
/// refresh mutation, and maintains 4-state (loading/empty/error/success) UI contract.
/// KMP integration point: TBD once the KMP core UserRepository is wired.
@Observable
final class TeslaAccountPageModel {
    var state: TeslaAccountState = .loading
    var isRefreshing = false

    /// Load the Tesla user profile. Called on .task appearance.
    func load() async {
        state = .loading

        // Integration point: KMP core API client for GET /tesla/user/profile
        // Currently simulates a network call until KMP binding is wired.
        try? await Task.sleep(for: .milliseconds(800))

        // Simulate empty state (no profile synced yet)
        state = .empty
    }

    /// Refresh the Tesla user profile from the Fleet API. Triggers POST /tesla/user/profile/refresh,
    /// then invalidates the cached profile and reloads.
    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        // Integration point: KMP core API client for POST /tesla/user/profile/refresh
        try? await Task.sleep(for: .milliseconds(1200))

        // After refresh completes, reload the profile
        await load()
    }
}
