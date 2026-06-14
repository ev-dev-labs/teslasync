import SwiftUI

/// GlassPanel3 — the role×permission matrix grid (web `MatrixGrid`). Columns are roles, rows
/// are the permission catalog grouped by category, cells are allow (✓) / deny (–) in read mode
/// and checkboxes in edit mode. Adaptive: a horizontally-scrollable columnar `Grid` on
/// macOS/iPad regular width and per-permission cards on compact iPhone. All copy resolves from
/// `Localizable.xcstrings`; cell state binds to the `@Observable` model's draft.
struct RbacMatrixGridPanel: View {
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

    private var groups: [RbacPermissionGroup] {
        RbacMatrix.groupedPermissions(session)
    }

    var body: some View {
        TSGlassPanel {
            if isCompact {
                compactCards
            } else {
                ScrollView(.horizontal, showsIndicators: true) {
                    regularGrid
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("rbac.title"))
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularGrid: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
            GridRow {
                columnHeader("rbac.permissionColumn")
                ForEach(session.roles) { role in
                    Text(verbatim: role.name)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textSecondary)
                        .accessibilityAddTraits(.isHeader)
                        .gridColumnAlignment(.center)
                }
            }
            Divider().overlay(Color.TS.border).gridCellColumns(columnCount)
            ForEach(groups) { group in
                GridRow {
                    categoryHeader(group.category).gridCellColumns(columnCount)
                }
                ForEach(group.permissions) { perm in
                    GridRow {
                        permissionLabel(perm)
                        ForEach(session.roles) { role in
                            RbacMatrixCell(model: model, roleID: role.id, permID: perm.id)
                        }
                    }
                    Divider().overlay(Color.TS.border.opacity(0.4)).gridCellColumns(columnCount)
                }
            }
        }
        .padding(.vertical, TSSpacing.xs)
    }

    private var columnCount: Int {
        1 + session.roles.count
    }

    private func columnHeader(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    private func categoryHeader(_ category: String) -> some View {
        Text(verbatim: rbacCategoryLabel(category))
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textMuted)
            .textCase(.uppercase)
            .accessibilityAddTraits(.isHeader)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, TSSpacing.xs)
    }

    private func permissionLabel(_ perm: RbacPermission) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: perm.name)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: perm.id)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .textSelection(.enabled)
        }
    }

    // MARK: - Compact (iPhone) per-permission cards

    private var compactCards: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    Text(verbatim: rbacCategoryLabel(group.category))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                        .textCase(.uppercase)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(group.permissions) { perm in
                        permissionCard(perm)
                    }
                }
            }
        }
    }

    private func permissionCard(_ perm: RbacPermission) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                permissionLabel(perm)
                ForEach(session.roles) { role in
                    HStack(spacing: TSSpacing.md) {
                        Text(verbatim: role.name)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textSecondary)
                        Spacer(minLength: TSSpacing.sm)
                        RbacMatrixCell(model: model, roleID: role.id, permID: perm.id)
                    }
                    .frame(minHeight: 44)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: perm.name))
    }
}

// MARK: - Matrix cell (web `renderCell`)

/// A single matrix cell. Read mode renders the web check/dash glyph with an allowed/denied
/// VoiceOver label; edit mode renders a ≥44pt checkbox bound to the draft, labelled with the
/// interpolated role/permission. Both modes read the draft (resynced to the snapshot on load).
struct RbacMatrixCell: View {
    let model: RbacMatrixPageModel
    let roleID: String
    let permID: String

    private var allowed: Bool {
        model.cellAllowed(roleID: roleID, permID: permID)
    }

    var body: some View {
        if model.editing {
            editToggle
        } else {
            readGlyph
        }
    }

    private var editToggle: some View {
        Button {
            model.toggle(roleID: roleID, permID: permID, allowed: !allowed)
        } label: {
            Image(systemName: allowed ? "checkmark.square.fill" : "square")
                .imageScale(.large)
                .foregroundStyle(allowed ? Color.TS.accent : Color.TS.textMuted)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .accessibilityLabel(Text(verbatim: String(format: String(localized: "rbac.cell.toggle"), roleID, permID)))
        .accessibilityAddTraits(allowed ? [.isButton, .isSelected] : .isButton)
    }

    private var readGlyph: some View {
        Image(systemName: allowed ? "checkmark" : "minus")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(allowed ? Color.TS.statusSuccess : Color.TS.textMuted)
            .frame(maxWidth: .infinity, minHeight: 28)
            .accessibilityLabel(Text(allowed ? "rbac.cell.allowed" : "rbac.cell.denied"))
    }
}

// MARK: - Category label (web `t('rbac.category.{cat}', cat)`)

/// Resolves a category's display label from `rbac.category.{cat}`, falling back to the raw
/// category id when the catalog has no entry — exactly the web `t(key, cat)` contract.
func rbacCategoryLabel(_ category: String) -> String {
    NSLocalizedString("rbac.category.\(category)", tableName: nil, bundle: .main, value: category, comment: "")
}
