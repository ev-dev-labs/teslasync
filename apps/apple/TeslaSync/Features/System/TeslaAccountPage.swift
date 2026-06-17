//
//  TeslaAccountPage.swift
//  TeslaSync — P7 System · TeslaAccountPage (Apple)
//
//  The SwiftUI parity of web/src/features/system/pages/TeslaAccountPage.tsx — displays
//  the current user's Tesla account profile synced from the Fleet API. Shows avatar,
//  name, email, and last-fetched timestamp with inline refresh button. Implements
//  4-state contract (loading/empty/error/success) with HIG-aligned materials, design
//  tokens (Color.TS, Font.TS, TSSpacing, TSRadius), and full i18n via Localizable.xcstrings.
//  Adaptive layout for macOS (regular) and iOS (compact/regular).
//

import SwiftUI

// MARK: - Top-Level Surface

/// The Tesla Account page. Renders sync status bar + profile card (GlassPanel1) with
/// avatar and KVList details (name, email, fetchedAt). Implements loading/empty/error/success
/// states per ADR-011 (no placeholders), ADR-014 (all strings via String(localized:)),
/// ADR-015 (a11y labels, Dynamic Type, ≥44pt targets).
public struct TeslaAccountPage: View {
    @State private var viewModel = TeslaAccountPageModel()
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                // Page header
                headerSection

                // Sync status bar + refresh button
                syncBar

                // Main content (state-driven)
                switch viewModel.state {
                case .loading:
                    loadingView
                case .empty:
                    emptyView
                case .error(let message):
                    errorView(message)
                case .success(let profile, let fetchedAt):
                    profileCard(profile, fetchedAt: fetchedAt)
                }
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(String(localized: "teslaAccount.title", defaultValue: "Tesla Account"))
        .task {
            await viewModel.load()
        }
        .refreshable {
            await viewModel.load()
        }
    }

    // MARK: - Header Section

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(String(localized: "teslaAccount.title", defaultValue: "Tesla Account"))
                .font(.TS.title)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)

            Text(String(
                localized: "teslaAccount.subtitle",
                defaultValue: "Your Tesla account profile synced from the Fleet API"
            ))
            .font(.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
        }
    }

    // MARK: - Sync Bar

    /// The sync status bar with last-synced timestamp and refresh button.
    private var syncBar: some View {
        HStack(spacing: TSSpacing.md) {
            // Status text (last synced or never synced)
            syncStatusText
                .font(.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Refresh button
            Button {
                Task { await viewModel.refresh() }
            } label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14, weight: .medium))
                        .rotationEffect(viewModel.isRefreshing ? .degrees(360) : .degrees(0))
                        .animation(
                            viewModel.isRefreshing ?
                                .linear(duration: 1).repeatForever(autoreverses: false) : .default,
                            value: viewModel.isRefreshing
                        )

                    Text(String(localized: "teslaAccount.refresh", defaultValue: "Refresh from Tesla"))
                        .font(.TS.bodySm)
                }
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.sm)
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isRefreshing)
            .accessibilityLabel(String(localized: "teslaAccount.refresh", defaultValue: "Refresh from Tesla"))
            .accessibilityHint("Fetches the latest profile from the Tesla Fleet API")
        }
    }

    /// The sync status text: "Last synced: X ago" or "Never synced — click Refresh to fetch from Tesla".
    @ViewBuilder
    private var syncStatusText: some View {
        switch viewModel.state {
        case .success(_, let fetchedAt):
            if let fetchedAt = fetchedAt {
                Text(String(
                    localized: "teslaAccount.lastSynced",
                    defaultValue: "Last synced: \(formatRelative(fetchedAt))"
                ))
            } else {
                Text(String(
                    localized: "teslaAccount.neverSynced",
                    defaultValue: "Never synced — click Refresh to fetch from Tesla"
                ))
            }
        default:
            Text(String(
                localized: "teslaAccount.neverSynced",
                defaultValue: "Never synced — click Refresh to fetch from Tesla"
            ))
        }
    }

    // MARK: - Loading State

    /// The loading view (skeleton/redacted state). Shows a shimmer placeholder panel
    /// matching the profile card layout.
    private var loadingView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            // Panel title
            RoundedRectangle(cornerRadius: TSRadius.sm)
                .fill(Color.TS.textMuted.opacity(0.15))
                .frame(width: 100, height: 20)
                .redacted(reason: .placeholder)

            // Avatar + details row
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                // Avatar skeleton
                Circle()
                    .fill(Color.TS.textMuted.opacity(0.15))
                    .frame(width: 80, height: 80)
                    .redacted(reason: .placeholder)

                // Details skeleton
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: TSRadius.sm)
                            .fill(Color.TS.textMuted.opacity(0.15))
                            .frame(height: 16)
                            .redacted(reason: .placeholder)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(TSSpacing.lg)
        .tsGlassPanel(cornerRadius: TSRadius.lg)
        .accessibilityLabel("Loading Tesla account profile")
    }

    // MARK: - Empty State (GlassPanel1 with empty state)

    /// The empty state: no profile synced yet. Renders inside the profile card panel.
    private var emptyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            // Panel title
            Text(String(localized: "teslaAccount.profile", defaultValue: "Profile"))
                .font(.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)

            // Empty state content
            ContentUnavailableView {
                Label(
                    String(
                        localized: "teslaAccount.noProfile",
                        defaultValue: "No profile data yet. Click \"Refresh from Tesla\" to sync your account."
                    ),
                    systemImage: "person.crop.circle"
                )
            } description: {
                EmptyView()
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.xl)
            .accessibilityLabel(String(
                localized: "teslaAccount.noProfile",
                defaultValue: "No profile data yet. Click \"Refresh from Tesla\" to sync your account."
            ))
        }
        .padding(TSSpacing.lg)
        .tsGlassPanel(cornerRadius: TSRadius.lg)
    }

    // MARK: - Error State

    /// The error state view. Renders a ContentUnavailableView with retry button.
    private func errorView(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            // Panel title
            Text(String(localized: "teslaAccount.profile", defaultValue: "Profile"))
                .font(.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)

            // Error content
            ContentUnavailableView {
                Label("Failed to load profile", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Retry") {
                    Task { await viewModel.load() }
                }
                .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.xl)
            .accessibilityLabel("Error loading profile: \(message)")
        }
        .padding(TSSpacing.lg)
        .tsGlassPanel(cornerRadius: TSRadius.lg)
    }

    // MARK: - Success State (Profile Card — GlassPanel1)

    /// The main profile card (GlassPanel1) with avatar and details.
    private func profileCard(_ profile: TeslaUserProfile, fetchedAt: String?) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            // Panel title
            Text(String(localized: "teslaAccount.profile", defaultValue: "Profile"))
                .font(.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)

            // Avatar + details row
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                // Avatar
                avatarView(profile.profileImageUrl)

                // Details (KVList equivalent)
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    // Name
                    kvRow(
                        label: String(localized: "teslaAccount.name", defaultValue: "Name"),
                        value: profile.fullName.isEmpty ? "—" : profile.fullName
                    )

                    // Email
                    kvRow(
                        label: String(localized: "teslaAccount.email", defaultValue: "Email"),
                        value: profile.email.isEmpty ? "—" : profile.email
                    )

                    // Fetched At
                    kvRow(
                        label: String(localized: "teslaAccount.fetchedAt", defaultValue: "Fetched At"),
                        value: formatDateTime(profile.fetchedAt)
                    )
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(TSSpacing.lg)
        .tsGlassPanel(cornerRadius: TSRadius.lg)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Tesla account profile")
    }

    // MARK: - Avatar View

    /// The profile avatar: renders profile_image_url if present, otherwise shows a placeholder icon.
    private func avatarView(_ imageUrl: String?) -> some View {
        Group {
            if let imageUrl = imageUrl, let url = URL(string: imageUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    case .failure, .empty:
                        placeholderAvatar
                    @unknown default:
                        placeholderAvatar
                    }
                }
            } else {
                placeholderAvatar
            }
        }
        .frame(width: 80, height: 80)
        .clipShape(Circle())
        .overlay(
            Circle()
                .stroke(Color.TS.border, lineWidth: 2)
        )
        .accessibilityLabel(String(localized: "teslaAccount.avatar", defaultValue: "Profile picture"))
    }

    /// The placeholder avatar (no image available).
    private var placeholderAvatar: some View {
        ZStack {
            Circle()
                .fill(Color.TS.surfaceGlass)

            Image(systemName: "person.crop.circle.badge.exclamationmark")
                .font(.system(size: 32, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    // MARK: - KV Row

    /// A key-value row: label (muted, small) + value (primary, regular).
    private func kvRow(label: String, value: String) -> some View {
       VStack(alignment: .leading, spacing: TSSpacing.xs) {
           Text(label)
               .font(.TS.caption)
               .foregroundStyle(Color.TS.textMuted)

           Text(value)
               .font(.TS.body)
               .foregroundStyle(Color.TS.textPrimary)
       }
       .accessibilityElement(children: .combine)
       .accessibilityLabel("\(label): \(value)")
    }
}

// MARK: - Previews

#Preview("TeslaAccountPage — Loading") {
    NavigationStack {
        TeslaAccountPage()
    }
    .preferredColorScheme(.dark)
}

#Preview("TeslaAccountPage — Empty") {
    let model = TeslaAccountPageModel()
    model.state = .empty
    return NavigationStack {
        TeslaAccountPage()
    }
    .preferredColorScheme(.dark)
}

#Preview("TeslaAccountPage — Error") {
    let model = TeslaAccountPageModel()
    model.state = .error("Network timeout. Check your connection and try again.")
    return NavigationStack {
        TeslaAccountPage()
    }
    .preferredColorScheme(.dark)
}

#Preview("TeslaAccountPage — Success") {
    let model = TeslaAccountPageModel()
    model.state = .success(
        TeslaUserProfile(
            id: 1,
            email: "john.doe@tesla.com",
            fullName: "John Doe",
            profileImageUrl: nil,
            fetchedAt: "2026-06-17T04:10:00.000Z",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2026-06-17T04:10:00.000Z"
        ),
        fetchedAt: "2026-06-17T04:10:00.000Z"
    )
    return NavigationStack {
        TeslaAccountPage()
    }
    .preferredColorScheme(.dark)
}
