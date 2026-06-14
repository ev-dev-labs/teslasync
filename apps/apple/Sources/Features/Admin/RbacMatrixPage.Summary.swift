import SwiftUI

/// GlassPanel2 — the matrix summary bar (web `rbac-summary`). Carries the operator's
/// self-context (my-roles + effective-permissions pills + the optional groups-header name) and
/// the read-only⇄edit controls (web Edit, or Cancel + Save with the live dirty-cell count).
/// Adaptive: a single row on macOS/iPad regular width, stacked on compact iPhone. All copy
/// resolves from `Localizable.xcstrings`; state binds to the `@Observable` model.
struct RbacSummaryPanel: View {
    let model: RbacMatrixPageModel
    let session: RbacMatrixSession

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        TSGlassPanel {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    context
                    actions
                }
            } else {
                HStack(alignment: .center, spacing: TSSpacing.md) {
                    context
                    Spacer(minLength: TSSpacing.md)
                    actions
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("rbac.title"))
    }

    // MARK: - Self-context (web my-roles + effective pills + groups header)

    private var context: some View {
        HStack(spacing: TSSpacing.sm) {
            RbacMyRolesPill(roles: session.myRoles)
            RbacEffectivePill(allowed: session.effectiveAllowedCount, total: session.permissionCount)
            if let name = session.groupsHeaderName, !name.isEmpty {
                Text(verbatim: String(format: String(localized: "rbac.groupsHeader.label"), name))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: - Edit / Save controls (web Edit ⇄ Cancel + Save)

    private var actions: some View {
        HStack(spacing: TSSpacing.sm) {
            if model.editing {
                TSButton("rbac.actions.cancel", variant: .ghost) {
                    model.cancelEdit()
                }
                .disabled(model.isSaving)
                saveButton
            } else {
                TSButton(variant: .secondary) {
                    model.beginEdit()
                } label: {
                    Label("rbac.actions.edit", systemImage: "lock.open")
                }
                .accessibilityLabel(Text("rbac.actions.edit"))
            }
        }
    }

    private var saveButton: some View {
        TSButton(variant: .primary) {
            Task { await model.save() }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "lock").accessibilityHidden(true)
                Text(verbatim: saveLabel)
            }
        }
        .disabled(model.isSaving || model.dirtyCount == 0)
        .accessibilityLabel(Text(verbatim: saveLabel))
    }

    /// Web `isPending ? t('rbac.actions.saving') : t('rbac.actions.save', { count })`.
    private var saveLabel: String {
        if model.isSaving {
            return String(localized: "rbac.actions.saving")
        }
        return String(format: String(localized: "rbac.actions.save"), String(model.dirtyCount))
    }
}

// MARK: - My-roles pill (web `MyRolesPill`)

/// The calling subject's claimed roles (web `payload.my_roles`): an info pill listing the
/// roles, or a neutral "no roles claimed" pill when none were forwarded.
struct RbacMyRolesPill: View {
    let roles: [String]

    var body: some View {
        if roles.isEmpty {
            TSBadge("rbac.myRoles.none", tone: .neutral)
        } else {
            RbacPill(
                systemImage: nil,
                text: String(format: String(localized: "rbac.myRoles.label"), roles.joined(separator: ", ")),
                tone: .info
            )
        }
    }
}

// MARK: - Effective pill (web `EffectivePill`)

/// "What I can do right now" — the count of permissions effective for the subject's roles
/// (web `effective_for_me`), neutral when zero else success-toned, with the web tooltip.
struct RbacEffectivePill: View {
    let allowed: Int
    let total: Int

    var body: some View {
        RbacPill(
            systemImage: "checkmark.shield",
            text: String(format: String(localized: "rbac.effective.count"), String(allowed), String(total)),
            tone: allowed == 0 ? .neutral : .success
        )
        .help(Text("rbac.effective.tooltip"))
        .accessibilityHint(Text("rbac.effective.tooltip"))
    }
}

// MARK: - Pill chrome

/// Shared capsule chrome for the interpolated summary pills (the web `Badge` look). Renders
/// already-localized text verbatim so the i18next `{{token}}` substitutions survive.
struct RbacPill: View {
    let systemImage: String?
    let text: String
    let tone: TSTone

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage).accessibilityHidden(true)
            }
            Text(verbatim: text)
        }
        .font(Font.TS.caption)
        .fontWeight(.medium)
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}
