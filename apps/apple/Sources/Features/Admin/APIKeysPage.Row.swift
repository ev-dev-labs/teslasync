import SwiftUI

// MARK: - Permission display metadata (web `PermissionBadge` cfg)

/// View-boundary mapping for `APIKeyPermission` (web `cfg` in `PermissionBadge`): the
/// localized label, the SF Symbol, and the tinted tone. Kept out of the Foundation-only
/// model layer. The `admin` tone uses the design-system power-purple token, matching the
/// web `#a855f7`.
extension APIKeyPermission {
    var labelKey: LocalizedStringKey {
        switch self {
        case .read: "Read"
        case .readWrite: "Read-Write"
        case .admin: "Admin"
        }
    }

    var badgeSystemImage: String {
        switch self {
        case .read: "shield.lefthalf.filled"
        case .readWrite: "exclamationmark.shield.fill"
        case .admin: "crown.fill"
        }
    }

    var badgeColor: Color {
        switch self {
        case .read: Color.TS.statusSuccess
        case .readWrite: Color.TS.statusWarning
        case .admin: Color.TS.chartSeriesPower
        }
    }
}

/// The permission chip (web `PermissionBadge`): a tinted capsule with the permission icon
/// + localized label. Tone-colored text on a matching tinted fill (chip), like `TSBadge`.
struct PermissionBadge: View {
    let permission: APIKeyPermission

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: permission.badgeSystemImage)
                .font(.system(size: 10, weight: .bold))
                .accessibilityHidden(true)
            Text(permission.labelKey)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
        }
        .foregroundStyle(permission.badgeColor)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(permission.badgeColor.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(permission.badgeColor.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(permission.labelKey))
    }
}

// MARK: - Key row (web per-key GlassPanel — GlassPanel2)

/// One API-key card (web `keys.map(k => <GlassPanel>…)` — the second web `GlassPanel`).
/// Reproduces the icon box, the name + permission chip + expired badge header, the
/// prefix / created / last-used meta line, and the trailing revoke + delete actions.
/// Expired keys are dimmed (web `opacity-50`) and hide the revoke action (web
/// `!isExpired(k) && …`). All copy resolves from `Localizable.xcstrings` with the web key
/// names; the row holds no state — it calls back into the `@Observable` model.
struct APIKeyRow: View {
    let entry: APIKeyEntry
    let isExpired: Bool
    let isRevoking: Bool
    let onRevoke: () -> Void
    let onDelete: () -> Void

    var body: some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                TSIconBox(systemName: "key.fill", tone: .accent)
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    titleRow
                    metaRow
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                actions
            }
        }
        .opacity(isExpired ? 0.6 : 1)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: entry.name))
    }

    // MARK: Title row — name + permission chip + (expired)

    private var titleRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: entry.name)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
            PermissionBadge(permission: entry.permissions)
            if isExpired {
                TSBadge("Expired", tone: .danger)
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: Meta row — prefix · created · last used

    private var metaRow: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: entry.keyPrefix)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Label {
                Text("Created") + Text(verbatim: " " + APIKeysFormat.date(entry.createdAt))
            } icon: {
                Image(systemName: "clock")
            }
            .labelStyle(.titleAndIcon)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
            if let lastUsedAt = entry.lastUsedAt {
                (Text("Last used") + Text(verbatim: " " + APIKeysFormat.date(lastUsedAt)))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: Trailing actions — revoke (unless expired) + delete

    private var actions: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isExpired {
                Button(action: onRevoke) {
                    Group {
                        if isRevoking {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "xmark.circle")
                                .font(.system(size: 16))
                        }
                    }
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.TS.statusWarning)
                .disabled(isRevoking)
                .help(Text("Revoke"))
                .accessibilityLabel(Text("Revoke"))
            }
            Button(action: onDelete) {
                Image(systemName: "trash")
                    .font(.system(size: 16))
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.statusDanger)
            .help(Text("Delete"))
            .accessibilityLabel(Text("Delete"))
        }
    }
}
