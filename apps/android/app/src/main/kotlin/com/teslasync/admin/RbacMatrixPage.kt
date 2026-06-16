// The native Jetpack Compose + Material 3 RbacMatrixPage admin surface — a parity port of
// web/src/features/admin/pages/RbacMatrixPage.tsx, the provider-agnostic role/permission matrix. It
// reproduces the page's three GlassPanels (the open-mode notice, the summary header, the matrix grid),
// every data state (loading / open-mode / empty / error / content), and every visible string (resolved from
// the generated res/values catalog, ADR-014): the "my roles" + "effective for me" pills, the Edit/Save/Cancel
// flow, and the read-only ✓ / – grid that flips to checkboxes in edit mode.
//
// Composition: [RbacMatrixPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the data + interaction snapshots);
// [RbacMatrixPageContent] is the stateless render layer driven entirely by [RbacDataState] +
// [RbacInteractionState] + [RbacMatrixActions]. All derivation lives in the framework-free model
// (RbacMatrixPageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod", "MatchingDeclarationName")

package io.teslasync.android.admin.rbac

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixSession
import io.teslasync.shared.core.presentation.rbacmatrix.RbacPermission
import io.teslasync.shared.core.presentation.rbacmatrix.RbacRole

/** The page's interaction callbacks, wired to the [RbacMatrixPageViewModel] (web event handlers). */
data class RbacMatrixActions(
    val onEdit: () -> Unit,
    val onCancel: () -> Unit,
    val onSave: () -> Unit,
    val onToggle: (roleId: String, permId: String, next: Boolean) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [RbacMatrixPageViewModel] over the supplied [source] (the host wires the
 * shared [io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixStore] via [asRbacMatrixSource]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun RbacMatrixPage(
    source: RbacMatrixSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: RbacMatrixPageViewModel =
        viewModel(
            key = RbacMatrixRegistration.SLUG,
            factory = viewModelFactory { initializer { RbacMatrixPageViewModel(source, logger) } },
        )
    RbacMatrixPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] data + interaction snapshots to the stateless content. */
@Composable
fun RbacMatrixPage(
    viewModel: RbacMatrixPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val data by viewModel.data.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            RbacMatrixActions(
                onEdit = viewModel::enterEdit,
                onCancel = viewModel::cancelEdit,
                onSave = viewModel::save,
                onToggle = viewModel::toggle,
                onRetry = viewModel::retry,
            )
        }

    RbacMatrixPageContent(
        data = data,
        interaction = interaction,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header + the data-state-driven panels (open-mode / loading / error / grid). */
@Composable
fun RbacMatrixPageContent(
    data: RbacDataState,
    interaction: RbacInteractionState,
    actions: RbacMatrixActions,
    modifier: Modifier = Modifier,
) {
    val session = data.ui.data
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageTitle(stringResource(R.string.translation_rbac_title))
        if (!data.ui.isLoading && !data.ui.hasError) {
            // The web PageContainer renders the subtitle for the open-mode / empty / content surfaces only.
            Caption(stringResource(R.string.translation_rbac_subtitle))
        }

        when {
            data.ui.isLoading -> RbacLoadingState()
            data.openMode -> RbacOpenModePanel()
            data.ui.hasError -> RbacErrorState(code = data.loadErrorCode, onRetry = actions.onRetry)
            session == null || session.hasNoRoles -> RbacEmptyState()
            else -> RbacMatrixSuccess(payload = session, interaction = interaction, actions = actions)
        }
    }
}

// ── Data states ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun RbacLoadingState() {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(Spacing.xl2)
                .semantics { contentDescription = LOADING_SEMANTIC },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spinner(size = SpinnerSize.Md)
    }
}

/** GlassPanel1 — the AUTH_MODE_OPEN notice (web `rbac-open-mode`), shown when forward-auth is not configured. */
@Composable
private fun RbacOpenModePanel() {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        RbacGlyphs.ShieldCheck,
                        contentDescription = null,
                        size = IconSize.Lg,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    SectionTitle(stringResource(R.string.translation_rbac_openMode_title))
                }
                HelperText(stringResource(R.string.translation_rbac_openMode_message))
            }
        }
    }
}

@Composable
private fun RbacErrorState(
    code: String?,
    onRetry: () -> Unit,
) {
    FadeIn {
        AlertBanner(
            message = code ?: stringResource(R.string.translation_rbac_errors_loadGeneric),
            tone = Tone.Danger,
            title = stringResource(R.string.translation_rbac_errors_loadTitle),
            action = BannerAction(label = stringResource(R.string.translation_rbac_actions_retry), onClick = onRetry),
        )
    }
}

@Composable
private fun RbacEmptyState() {
    FadeIn {
        EmptyState(
            message = stringResource(R.string.translation_rbac_empty_message),
            icon = RbacGlyphs.ShieldCheck,
            title = stringResource(R.string.translation_rbac_empty_title),
        )
    }
}

// ── Content (GlassPanel2 summary + optional save-error banner + GlassPanel3 grid) ───────────────────────────

@Composable
private fun RbacMatrixSuccess(
    payload: RbacMatrixSession,
    interaction: RbacInteractionState,
    actions: RbacMatrixActions,
) {
    FadeIn {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            RbacSummaryPanel(payload = payload, interaction = interaction, actions = actions)

            val submitError = interaction.submitError
            if (submitError != null) {
                AlertBanner(
                    message = submitError.code ?: stringResource(R.string.translation_rbac_errors_saveGeneric),
                    tone = Tone.Danger,
                )
            }

            RbacMatrixGridPanel(payload = payload, interaction = interaction, actions = actions)
        }
    }
}

/** GlassPanel2 — the summary header: the role / effective pills + the groups-header note + the edit controls. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RbacSummaryPanel(
    payload: RbacMatrixSession,
    interaction: RbacInteractionState,
    actions: RbacMatrixActions,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                MyRolesPill(payload)
                EffectivePill(payload)
                val groupsHeader = payload.groupsHeaderName
                if (groupsHeader != null) {
                    Caption(stringResource(R.string.translation_rbac_groupsHeader_label, groupsHeader))
                }
            }
            RbacEditControls(interaction = interaction, actions = actions)
        }
    }
}

/** "My roles: …" pill — info when the subject has roles, neutral "none" otherwise (web `MyRolesPill`). */
@Composable
private fun MyRolesPill(payload: RbacMatrixSession) {
    if (payload.myRoles.isEmpty()) {
        Badge(text = stringResource(R.string.translation_rbac_myRoles_none), variant = BadgeVariant.Neutral)
    } else {
        Badge(
            text = stringResource(R.string.translation_rbac_myRoles_label, payload.myRoles.joinToString(", ")),
            variant = BadgeVariant.Info,
        )
    }
}

/** "N / M effective" pill with a shield glyph + the tooltip semantics (web `EffectivePill`). */
@Composable
private fun EffectivePill(payload: RbacMatrixSession) {
    val allowed = effectiveAllowedCount(payload)
    val total = effectiveTotal(payload)
    val variant = if (allowed == 0) BadgeVariant.Neutral else BadgeVariant.Success
    val tooltip = stringResource(R.string.translation_rbac_effective_tooltip)
    val tint = if (allowed == 0) MaterialTheme.colorScheme.onSurfaceVariant else TeslaTokens.status.success
    Row(
        modifier = Modifier.semantics { contentDescription = tooltip },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(RbacGlyphs.ShieldCheck, contentDescription = null, size = IconSize.Sm, tint = tint)
        Badge(text = stringResource(R.string.translation_rbac_effective_count, allowed.toString(), total.toString()), variant = variant)
    }
}

/** Edit / Save / Cancel controls — the web summary panel's right-hand button cluster. */
@Composable
private fun RbacEditControls(
    interaction: RbacInteractionState,
    actions: RbacMatrixActions,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!interaction.editing) {
            Button(
                label = stringResource(R.string.translation_rbac_actions_edit),
                onClick = actions.onEdit,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                leadingIcon = RbacGlyphs.Unlock,
            )
        } else {
            Button(
                label = stringResource(R.string.translation_rbac_actions_cancel),
                onClick = actions.onCancel,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                enabled = !interaction.saving,
            )
            Button(
                label =
                    if (interaction.saving) {
                        stringResource(R.string.translation_rbac_actions_saving)
                    } else {
                        stringResource(R.string.translation_rbac_actions_save, interaction.dirtyCount.toString())
                    },
                onClick = actions.onSave,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                leadingIcon = RbacGlyphs.Lock,
                enabled = !interaction.saving && interaction.dirtyCount > 0,
                loading = interaction.saving,
            )
        }
    }
}

// ── GlassPanel3 — the matrix grid (header + category sections + permission rows) ─────────────────────────────

/** GlassPanel3 — the role × permission grid (web `MatrixGrid`); read-only ✓/– flips to checkboxes in edit. */
@Composable
private fun RbacMatrixGridPanel(
    payload: RbacMatrixSession,
    interaction: RbacInteractionState,
    actions: RbacMatrixActions,
) {
    GlassPanel(padding = PanelPadding.None) {
        val hScroll = rememberScrollState()
        val grouped = remember(payload.permissions) { permsByCategory(payload.permissions) }
        val categories = remember(payload) { orderedCategories(payload) }
        Column(modifier = Modifier.fillMaxWidth()) {
            RbacGridHeader(roles = payload.roles, scroll = hScroll)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            categories.forEach { category ->
                val perms = grouped[category].orEmpty()
                if (perms.isEmpty()) return@forEach
                RbacCategoryRow(category = category)
                perms.forEach { perm ->
                    RbacPermRow(
                        perm = perm,
                        roles = payload.roles,
                        payload = payload,
                        interaction = interaction,
                        actions = actions,
                        scroll = hScroll,
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = DIVIDER_ALPHA))
                }
            }
        }
    }
}

@Composable
private fun RbacGridHeader(
    roles: List<RbacRole>,
    scroll: androidx.compose.foundation.ScrollState,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .horizontalScroll(scroll)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(stringResource(R.string.translation_rbac_permissionColumn), modifier = Modifier.width(PERM_COL_W))
        roles.forEach { role ->
            Box(modifier = Modifier.width(ROLE_COL_W), contentAlignment = Alignment.Center) {
                Caption(role.name)
            }
        }
    }
}

@Composable
private fun RbacCategoryRow(category: String) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = CATEGORY_BG_ALPHA))
                .padding(horizontal = Spacing.md, vertical = Spacing.xs),
    ) {
        Caption(categoryLabel(category))
    }
}

@Composable
private fun RbacPermRow(
    perm: RbacPermission,
    roles: List<RbacRole>,
    payload: RbacMatrixSession,
    interaction: RbacInteractionState,
    actions: RbacMatrixActions,
    scroll: androidx.compose.foundation.ScrollState,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .horizontalScroll(scroll)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.width(PERM_COL_W)) {
            BodyText(perm.name.ifEmpty { perm.id })
            Caption(perm.id)
        }
        roles.forEach { role ->
            val allowed =
                if (interaction.editing) {
                    interaction.draft.isAllowed(role.id, perm.id)
                } else {
                    payload.matrix[role.id]?.get(perm.id) ?: false
                }
            Box(modifier = Modifier.width(ROLE_COL_W), contentAlignment = Alignment.Center) {
                RbacCell(
                    editing = interaction.editing,
                    allowed = allowed,
                    roleId = role.id,
                    permId = perm.id,
                    onToggle = actions.onToggle,
                )
            }
        }
    }
}

/** One grid cell: a read-only ✓ / – mark, or an editable checkbox in edit mode (web `renderCell`). */
@Composable
private fun RbacCell(
    editing: Boolean,
    allowed: Boolean,
    roleId: String,
    permId: String,
    onToggle: (String, String, Boolean) -> Unit,
) {
    if (editing) {
        val toggleDesc = stringResource(R.string.translation_rbac_cell_toggle, roleId, permId)
        Checkbox(
            checked = allowed,
            onCheckedChange = { onToggle(roleId, permId, it) },
            modifier = Modifier.semantics { contentDescription = toggleDesc },
        )
    } else {
        val desc =
            if (allowed) {
                stringResource(R.string.translation_rbac_cell_allowed)
            } else {
                stringResource(R.string.translation_rbac_cell_denied)
            }
        Box(modifier = Modifier.semantics { contentDescription = desc }, contentAlignment = Alignment.Center) {
            if (allowed) {
                Icon(TeslaGlyphs.Check, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.status.success)
            } else {
                Icon(
                    TeslaGlyphs.Minus,
                    contentDescription = null,
                    size = IconSize.Md,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** Resolves a permission-category section label, falling back to the server-supplied category key. */
@Composable
private fun categoryLabel(category: String): String =
    when (category) {
        "admin" -> stringResource(R.string.translation_rbac_category_admin)
        "automation" -> stringResource(R.string.translation_rbac_category_automation)
        "commands" -> stringResource(R.string.translation_rbac_category_commands)
        "fleet" -> stringResource(R.string.translation_rbac_category_fleet)
        "notifications" -> stringResource(R.string.translation_rbac_category_notifications)
        else -> category
    }

private const val LOADING_SEMANTIC = "rbac-loading"
private const val DIVIDER_ALPHA = 0.5f
private const val CATEGORY_BG_ALPHA = 0.4f
private val PERM_COL_W: Dp = 220.dp
private val ROLE_COL_W: Dp = 112.dp
