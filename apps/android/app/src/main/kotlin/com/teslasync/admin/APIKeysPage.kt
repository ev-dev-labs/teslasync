// The native Jetpack Compose + Material 3 APIKeysPage feature view — a parity port of
// web/src/features/admin/pages/APIKeysPage.tsx, the API-key management screen. It reproduces the web
// composition end to end: the page header (title + subtitle + "Create Key" action), the create modal with its
// two faces (the new-key form ↔ the one-time "API Key Created" reveal with a masked secret + copy button), the
// issued-keys list (each key a glass row with a permission badge, an "Expired" badge, prefix + created / last
// used metadata, and revoke + delete affordances), and the delete-confirmation dialog. The key feed is bound
// through the shared P1/S8 state-holder layer as a [UiState], so the surface renders every lifecycle state the
// layer can carry — loading, hard error with retry, empty, content, and stale/offline ("last known") — without
// ever performing HTTP itself (ADR-002).
//
// Composition: [APIKeysPage] is the stateful entry (collects the feed + interaction snapshot, records the
// one-shot `view.opened` diagnostic); [APIKeysPageContent] is the stateless renderer that is the unit/UI-test +
// preview entry point. All projection logic lives in the framework-free model (APIKeysPageModel.kt); this file
// is a thin render layer. Every visible string resolves from the platform string catalog
// (res/values/strings.xml) via `stringResource` (ADR-014) and every interactive control carries an accessible
// name with a ≥ 48 dp touch target (ADR-015).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) cannot match
// the app's `io.teslasync.android.*` package root. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + helpers + previews. `TooManyFunctions`/`LargeClass` reflect the surface's full parity.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "TooManyFunctions", "LargeClass")

package io.teslasync.android.admin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.MaskVariant
import io.teslasync.android.components.ui.MaskedValue
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.iconColorFor
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.PageHosts
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private const val EM_DASH = "\u2014"

/** The localized absolute date formatter for the created / last-used metadata (render-only; API 26+ `java.time`). */
private val METADATA_DATE_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withZone(ZoneId.systemDefault())

// ── Strings (every visible literal resolved from res/values/strings.xml, ADR-014) ────────────────────────────

/**
 * The localized microcopy the surface renders, resolved once at the Compose boundary so the stateless content +
 * previews + tests pass a deterministic instance. Field names mirror the web i18n keys; the parameterized delete
 * message is resolved at the dialog site with the target key name.
 */
data class ApiKeysStrings(
    val title: String,
    val subtitle: String,
    val createKey: String,
    val apiKeyCreated: String,
    val newApiKey: String,
    val copyWarning: String,
    val clickToReveal: String,
    val copyApiKey: String,
    val copy: String,
    val done: String,
    val name: String,
    val myApplication: String,
    val permissions: String,
    val read: String,
    val readWrite: String,
    val admin: String,
    val generateKey: String,
    val cancel: String,
    val noApiKeys: String,
    val emptyMessage: String,
    val expired: String,
    val created: String,
    val lastUsed: String,
    val revoke: String,
    val delete: String,
    val deleteApiKey: String,
    val close: String,
    val retry: String,
    val errorTitle: String,
    val errorMessage: String,
) {
    /** The localized label for [level] (web `PermissionBadge` label). */
    fun permissionLabel(level: PermissionLevel): String =
        when (level) {
            PermissionLevel.Read -> read
            PermissionLevel.ReadWrite -> readWrite
            PermissionLevel.Admin -> admin
        }
}

/** Resolves [ApiKeysStrings] from the platform string catalog (re-resolved on a locale change). */
@Composable
fun rememberApiKeysStrings(): ApiKeysStrings =
    ApiKeysStrings(
        title = stringResource(R.string.translation_API_Keys),
        subtitle = stringResource(R.string.translation_Manage_programmatic_access_to_TeslaSync),
        createKey = stringResource(R.string.translation_Create_Key),
        apiKeyCreated = stringResource(R.string.translation_API_Key_Created),
        newApiKey = stringResource(R.string.translation_New_API_Key),
        copyWarning = stringResource(R.string.translation_Copy_this_key_now___it_won_t_be_shown_again),
        clickToReveal = stringResource(R.string.translation_API_key__click_to_reveal),
        copyApiKey = stringResource(R.string.translation_Copy_API_key),
        copy = stringResource(R.string.translation_Copy),
        done = stringResource(R.string.translation_Done),
        name = stringResource(R.string.translation_Name),
        myApplication = stringResource(R.string.translation_My_Application),
        permissions = stringResource(R.string.translation_Permissions),
        read = stringResource(R.string.translation_Read),
        readWrite = stringResource(R.string.translation_Read_Write),
        admin = stringResource(R.string.translation_Admin),
        generateKey = stringResource(R.string.translation_Generate_Key),
        cancel = stringResource(R.string.translation_Cancel),
        noApiKeys = stringResource(R.string.translation_No_API_keys),
        emptyMessage = stringResource(R.string.translation_Create_an_API_key_to_enable_programmatic_access_to_TeslaSync_data_and_controls),
        expired = stringResource(R.string.translation_Expired),
        created = stringResource(R.string.translation_Created),
        lastUsed = stringResource(R.string.translation_Last_used),
        revoke = stringResource(R.string.translation_Revoke),
        delete = stringResource(R.string.translation_Delete),
        deleteApiKey = stringResource(R.string.translation_Delete_API_Key),
        close = stringResource(R.string.translation_common_close),
        retry = stringResource(R.string.translation_common_retry),
        errorTitle = stringResource(R.string.translation_error_loadFailed),
        errorMessage = stringResource(R.string.translation_error_serverError_message),
    )

// ── Callback bundle (the web component's handlers, threaded into the stateless content) ───────────────────────

/** The interaction callbacks the stateless content invokes — wired from the ViewModel by the stateful entry. */
class ApiKeysActions(
    val onCreateOpen: () -> Unit,
    val onCreateClose: () -> Unit,
    val onName: (String) -> Unit,
    val onPermission: (PermissionLevel) -> Unit,
    val onGenerate: () -> Unit,
    val onRevoke: (Long) -> Unit,
    val onRequestDelete: (ApiKey) -> Unit,
    val onCancelDelete: () -> Unit,
    val onConfirmDelete: () -> Unit,
    val onRetry: () -> Unit,
) {
    companion object {
        /** Binds the callbacks to [vm] (the production wiring). */
        fun from(vm: ApiKeysPageViewModel): ApiKeysActions =
            ApiKeysActions(
                onCreateOpen = vm::openCreate,
                onCreateClose = vm::closeCreate,
                onName = vm::setName,
                onPermission = vm::setPermission,
                onGenerate = vm::generate,
                onRevoke = vm::revoke,
                onRequestDelete = vm::requestDelete,
                onCancelDelete = vm::cancelDelete,
                onConfirmDelete = vm::confirmDelete,
                onRetry = vm::retry,
            )

        /** A no-op bundle for previews. */
        val NONE: ApiKeysActions =
            ApiKeysActions({}, {}, {}, {}, {}, {}, {}, {}, {}, {})
    }
}

// ── Stateful entry points ────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [ApiKeysPageViewModel] over the supplied [source] (the host wires the shared
 * [io.teslasync.shared.core.presentation.admin.AdminStore] via [asApiKeysSource]). [logger] defaults to the
 * app's redacting logger.
 */
@Composable
fun APIKeysPage(
    source: ApiKeysSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: ApiKeysPageViewModel =
        viewModel(
            key = ApiKeysPageRegistration.SLUG,
            factory = ApiKeysPageViewModel.factory(source, logger),
        )
    APIKeysPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feed + interaction snapshot to the stateless content. */
@Composable
fun APIKeysPage(
    viewModel: ApiKeysPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val keysState by viewModel.keys.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val actions = remember(viewModel) { ApiKeysActions.from(viewModel) }
    APIKeysPageContent(
        keysState = keysState,
        interaction = interaction,
        actions = actions,
        nowMillis = System.currentTimeMillis(),
        modifier = modifier,
    )
}

// ── Stateless content (unit/UI-test + preview entry point) ───────────────────────────────────────────────────

/**
 * Stateless renderer for the whole surface. Draws the header, the create modal (rendered only while open), the
 * per-state key list (loading skeletons / content rows / friendly empty / error with retry), and the delete
 * dialog (rendered only while a target is set). Hoisted out of the ViewModel so each state is preview- and
 * screenshot-testable with hand-built inputs.
 */
@Composable
fun APIKeysPageContent(
    keysState: UiState<List<ApiKey>>,
    interaction: ApiKeysInteraction,
    actions: ApiKeysActions,
    nowMillis: Long,
    modifier: Modifier = Modifier,
    strings: ApiKeysStrings = rememberApiKeysStrings(),
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageHeader(strings = strings, onCreateOpen = actions.onCreateOpen)
        KeysList(state = keysState, strings = strings, nowMillis = nowMillis, actions = actions)
    }

    if (interaction.showCreate) {
        CreateKeyModal(interaction = interaction, strings = strings, actions = actions)
    }

    interaction.deleteTarget?.let { target ->
        DeleteDialog(target = target, strings = strings, actions = actions)
    }
}

/** The page header: title + subtitle on the lead, the "Create Key" primary action on the trail (web `PageContainer`). */
@Composable
private fun PageHeader(
    strings: ApiKeysStrings,
    onCreateOpen: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(strings.title, modifier = Modifier.semantics { heading() })
            HelperText(strings.subtitle)
        }
        Button(
            label = strings.createKey,
            onClick = onCreateOpen,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            leadingIcon = ApiKeysGlyphs.Key,
        )
    }
}

// ── Keys list (loading / error / empty / content) ────────────────────────────────────────────────────────────

/** The issued-keys region, switching across every [UiState] phase so it is never a blank box. */
@Composable
private fun KeysList(
    state: UiState<List<ApiKey>>,
    strings: ApiKeysStrings,
    nowMillis: Long,
    actions: ApiKeysActions,
) {
    when {
        state.isLoading -> LoadingList()
        state.isError ->
            GlassPanel(modifier = Modifier.fillMaxWidth()) {
                ErrorDisplay(
                    message = strings.errorMessage,
                    title = strings.errorTitle,
                    icon = ApiKeysGlyphs.XCircle,
                    onRetry = actions.onRetry,
                    retryLabel = strings.retry,
                )
            }
        state.isEmpty ->
            GlassPanel(modifier = Modifier.fillMaxWidth()) {
                EmptyState(
                    message = strings.emptyMessage,
                    icon = ApiKeysGlyphs.Key,
                    title = strings.noApiKeys,
                )
            }
        else -> {
            val keys = state.data ?: emptyList()
            StaggerContainer(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                keys.forEachIndexed { index, key ->
                    StaggerItem(index = index, modifier = Modifier.fillMaxWidth()) {
                        ApiKeyRow(key = key, strings = strings, nowMillis = nowMillis, actions = actions)
                    }
                }
            }
        }
    }
}

/** The first-load skeleton: three key-row skeletons (web `[1,2,3].map(<Skeleton/>)`). */
@Composable
private fun LoadingList() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) {
            Skeleton(modifier = Modifier.fillMaxWidth().height(SKELETON_ROW_HEIGHT))
        }
    }
}

/** One issued-key row (web list item): icon box, name + permission/expired badges, metadata, and actions. */
@Composable
private fun ApiKeyRow(
    key: ApiKey,
    strings: ApiKeysStrings,
    nowMillis: Long,
    actions: ApiKeysActions,
) {
    val expired = key.isExpired(nowMillis)
    GlassPanel(
        modifier = Modifier.fillMaxWidth().alpha(if (expired) EXPIRED_ALPHA else 1f),
        padding = PanelPadding.Md,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconBox(tone = IconBoxTone.Info) {
                Icon(ApiKeysGlyphs.Key, contentDescription = null, size = IconSize.Lg, tint = iconColorFor(IconBoxTone.Info))
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = key.name,
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    PermissionBadge(level = key.permission, strings = strings)
                    if (expired) {
                        Badge(text = strings.expired, variant = BadgeVariant.Danger, dot = true)
                    }
                }
                KeyMetadataRow(key = key, strings = strings)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (!expired) {
                    IconButton(
                        imageVector = ApiKeysGlyphs.XCircle,
                        contentDescription = strings.revoke,
                        onClick = { actions.onRevoke(key.id) },
                        size = IconSize.Md,
                        variant = IconButtonVariant.Standard,
                    )
                }
                IconButton(
                    imageVector = ApiKeysGlyphs.Trash,
                    contentDescription = strings.delete,
                    onClick = { actions.onRequestDelete(key) },
                    size = IconSize.Md,
                    variant = IconButtonVariant.Standard,
                )
            }
        }
    }
}

/** The key's prefix + created / last-used metadata line (web row footer). */
@Composable
private fun KeyMetadataRow(
    key: ApiKey,
    strings: ApiKeysStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CodeText(key.keyPrefix)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
            Icon(ApiKeysGlyphs.Clock, contentDescription = null, size = IconSize.Xs)
            Caption("${strings.created} ${formatMillis(key.createdAtMillis)}")
        }
        key.lastUsedAtMillis?.let { used ->
            Caption("${strings.lastUsed} ${formatMillis(used)}")
        }
    }
}

/**
 * The permission chip (web `PermissionBadge`): a tinted pill with a level glyph + label. The tone uses the design
 * tokens (success / warning / tertiary) so the badge honours light + dark + dynamic-color schemes (ADR-005/015).
 */
@Composable
private fun PermissionBadge(
    level: PermissionLevel,
    strings: ApiKeysStrings,
) {
    val tone = permissionTone(level)
    val glyph = permissionGlyph(level)
    Surface(
        shape = MaterialTheme.shapes.small,
        color = tone.copy(alpha = PERMISSION_WASH_ALPHA),
        contentColor = tone,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(glyph, contentDescription = null, size = IconSize.Xs, tint = tone)
            Text(
                text = strings.permissionLabel(level),
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun permissionTone(level: PermissionLevel): Color =
    when (level) {
        PermissionLevel.Read -> iconColorFor(IconBoxTone.Success)
        PermissionLevel.ReadWrite -> iconColorFor(IconBoxTone.Warning)
        PermissionLevel.Admin -> MaterialTheme.colorScheme.tertiary
    }

private fun permissionGlyph(level: PermissionLevel): ImageVector =
    when (level) {
        PermissionLevel.Read -> ApiKeysGlyphs.Shield
        PermissionLevel.ReadWrite -> ApiKeysGlyphs.ShieldAlert
        PermissionLevel.Admin -> ApiKeysGlyphs.Crown
    }

// ── Create modal (GlassPanel1 reveal face) ───────────────────────────────────────────────────────────────────

/**
 * The create modal (web `Modal`). Its title + body switch between the just-minted reveal (when
 * [ApiKeysInteraction.generatedKey] is set) and the new-key form, exactly as the web `generatedKey ? … : …`.
 */
@Composable
private fun CreateKeyModal(
    interaction: ApiKeysInteraction,
    strings: ApiKeysStrings,
    actions: ApiKeysActions,
) {
    val title = if (interaction.generatedKey != null) strings.apiKeyCreated else strings.newApiKey
    Modal(
        onDismissRequest = actions.onCreateClose,
        title = title,
        closeLabel = strings.close,
    ) {
        if (interaction.generatedKey != null) {
            GeneratedKeyPanel(secret = interaction.generatedKey, strings = strings, onDone = actions.onCreateClose)
        } else {
            CreateKeyForm(interaction = interaction, strings = strings, actions = actions)
        }
    }
}

/** The one-time reveal of the minted secret (web `generatedKey` branch): GlassPanel1 + masked value + copy + Done. */
@Composable
private fun ColumnScope.GeneratedKeyPanel(
    secret: String,
    strings: ApiKeysStrings,
    onDone: () -> Unit,
) {
    HelperText(strings.copyWarning)
    Spacer(Modifier.height(Spacing.md))
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        GlassPanel(
            modifier = Modifier.weight(1f),
            padding = PanelPadding.Sm,
        ) {
            MaskedValue(
                value = secret,
                variant = MaskVariant.ApiKey,
                revealLabel = strings.clickToReveal,
                hideLabel = strings.clickToReveal,
                accessibleName = strings.clickToReveal,
                copyable = false,
            )
        }
        CopyButton(
            text = secret,
            copyLabel = strings.copyApiKey,
            copiedLabel = strings.copy,
            iconOnly = true,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Md,
        )
    }
    Spacer(Modifier.height(Spacing.lg))
    Button(label = strings.done, onClick = onDone, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
}

/** The new-key form (web `else` branch): a name field, a permission select, and Generate / Cancel actions. */
@Composable
private fun ColumnScope.CreateKeyForm(
    interaction: ApiKeysInteraction,
    strings: ApiKeysStrings,
    actions: ApiKeysActions,
) {
    Input(
        value = interaction.newName,
        onValueChange = actions.onName,
        label = strings.name,
        hint = strings.myApplication,
    )
    Spacer(Modifier.height(Spacing.md))
    Select(
        options =
            listOf(
                SelectOption(PermissionLevel.Read.wire, strings.read),
                SelectOption(PermissionLevel.ReadWrite.wire, strings.readWrite),
                SelectOption(PermissionLevel.Admin.wire, strings.admin),
            ),
        selectedValue = interaction.newPermission.wire,
        onSelect = { wire -> actions.onPermission(PermissionLevel.fromWire(wire)) },
        label = strings.permissions,
    )
    Spacer(Modifier.height(Spacing.lg))
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
        Button(
            label = strings.generateKey,
            onClick = actions.onGenerate,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            enabled = interaction.canGenerate,
            loading = interaction.creating,
            leadingIcon = ApiKeysGlyphs.Key,
        )
        Button(label = strings.cancel, onClick = actions.onCreateClose, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
    }
}

/** The delete-confirmation dialog (web `ConfirmDialog`); the message interpolates the target key name. */
@Composable
private fun DeleteDialog(
    target: ApiKey,
    strings: ApiKeysStrings,
    actions: ApiKeysActions,
) {
    ConfirmDialog(
        title = strings.deleteApiKey,
        message = stringResource(R.string.translation_Are_you_sure_you_want_to_permanently_delete_the_key____name, target.name),
        confirmLabel = strings.delete,
        cancelLabel = strings.cancel,
        onConfirm = actions.onConfirmDelete,
        onCancel = actions.onCancelDelete,
        severity = ConfirmSeverity.Danger,
        closeLabel = strings.close,
    )
}

/** Formats an epoch-ms stamp as a localized medium date, or an em dash when absent (web `formatDate`). */
private fun formatMillis(millis: Long?): String =
    millis?.let { runCatching { METADATA_DATE_FORMATTER.format(java.time.Instant.ofEpochMilli(it)) }.getOrDefault(EM_DASH) } ?: EM_DASH

private const val EXPIRED_ALPHA = 0.5f
private const val PERMISSION_WASH_ALPHA = 0.16f
private const val SKELETON_ROWS = 3
private val SKELETON_ROW_HEIGHT = 80.dp

// ── Host registration (the PageHosts seam for the `apiKeys` route, web `/api-keys`) ──────────────────────────

/**
 * The navigation host seam for the `apiKeys` destination (web `/api-keys`). The app DI step calls
 * [register] with a real source — `adminStore.asApiKeysSource()` — at process start, attaching the live
 * [APIKeysPage] content to the route registered in [io.teslasync.android.navigation.Destinations]. Idempotent.
 * No fabricated data is ever registered; until the real source is supplied the route resolves to the shared
 * not-found screen, exactly like every not-yet-wired destination.
 */
object ApiKeysPageHost {
    private var registered = false

    /** Registers the live [APIKeysPage] host into [PageHosts] for the `apiKeys` route. Safe to call repeatedly. */
    fun register(source: ApiKeysSource) {
        if (registered) return
        registered = true
        PageHosts.register(ApiKeysPageRegistration.ROUTE) { APIKeysPage(source = source) }
    }
}

// ── Previews — one per rendered state (content / empty / loading / error / create form / create reveal) ───────

private fun previewKeys(): List<ApiKey> = InMemoryApiKeysSource.SAMPLE_KEYS

private fun previewStrings(): ApiKeysStrings =
    ApiKeysStrings(
        title = "API Keys",
        subtitle = "Manage programmatic access to TeslaSync",
        createKey = "Create Key",
        apiKeyCreated = "API Key Created",
        newApiKey = "New API Key",
        copyWarning = "Copy this key now \u2014 it won't be shown again.",
        clickToReveal = "API key, click to reveal",
        copyApiKey = "Copy API key",
        copy = "Copy",
        done = "Done",
        name = "Name",
        myApplication = "My Application",
        permissions = "Permissions",
        read = "Read",
        readWrite = "Read-Write",
        admin = "Admin",
        generateKey = "Generate Key",
        cancel = "Cancel",
        noApiKeys = "No API keys",
        emptyMessage = "Create an API key to enable programmatic access to TeslaSync data and controls.",
        expired = "Expired",
        created = "Created",
        lastUsed = "Last used",
        revoke = "Revoke",
        delete = "Delete",
        deleteApiKey = "Delete API Key",
        close = "Close",
        retry = "Retry",
        errorTitle = "Failed to load data",
        errorMessage = "Something went wrong on our end. Please try again.",
    )

@Preview(name = "API Keys — content", showBackground = true)
@Composable
private fun ApiKeysContentPreview() {
    TeslaSyncTheme {
        APIKeysPageContent(
            keysState = UiState(UiPhase.Content, previewKeys()),
            interaction = ApiKeysInteraction(),
            actions = ApiKeysActions.NONE,
            nowMillis = 1_717_300_000_000L,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "API Keys — empty", showBackground = true)
@Composable
private fun ApiKeysEmptyPreview() {
    TeslaSyncTheme {
        APIKeysPageContent(
            keysState = UiState(UiPhase.Empty, emptyList()),
            interaction = ApiKeysInteraction(),
            actions = ApiKeysActions.NONE,
            nowMillis = 0L,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "API Keys — loading", showBackground = true)
@Composable
private fun ApiKeysLoadingPreview() {
    TeslaSyncTheme {
        APIKeysPageContent(
            keysState = UiState.loading(),
            interaction = ApiKeysInteraction(),
            actions = ApiKeysActions.NONE,
            nowMillis = 0L,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "API Keys — error", showBackground = true)
@Composable
private fun ApiKeysErrorPreview() {
    TeslaSyncTheme {
        APIKeysPageContent(
            keysState = UiState(UiPhase.Error),
            interaction = ApiKeysInteraction(),
            actions = ApiKeysActions.NONE,
            nowMillis = 0L,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "API Keys — create form", showBackground = true)
@Composable
private fun ApiKeysCreateFormPreview() {
    TeslaSyncTheme {
        APIKeysPageContent(
            keysState = UiState(UiPhase.Content, previewKeys()),
            interaction = ApiKeysInteraction(showCreate = true, newName = "My Application", newPermission = PermissionLevel.ReadWrite),
            actions = ApiKeysActions.NONE,
            nowMillis = 0L,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "API Keys — create reveal", showBackground = true)
@Composable
private fun ApiKeysCreateRevealPreview() {
    TeslaSyncTheme {
        APIKeysPageContent(
            keysState = UiState(UiPhase.Content, previewKeys()),
            interaction = ApiKeysInteraction(showCreate = true, generatedKey = InMemoryApiKeysSource.SAMPLE_NEW_KEY),
            actions = ApiKeysActions.NONE,
            nowMillis = 0L,
            strings = previewStrings(),
        )
    }
}
