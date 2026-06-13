// Compose render layer for the ShareDriveDialog modal/dialog surface — the native analogue of the JSX the web component
// returns (web/src/features/driving/components/ShareDriveDialog.tsx). It is a thin shell over the pure
// [ShareDriveDialogProjection] derivations + the [ShareDriveDialogViewModel] orchestration: a Material 3 modal that
// hosts either the create form (description, optional title, the include-speed/include-telemetry toggles, the link-expiry
// select, and the Generate action) or — once a link is created — the result panel (the public URL, a copy + an
// open-in-browser action, and a "create another" affordance), and below it the drive's existing share links as a
// cache-then-network list with every state reproduced (loading / content / empty / stale / offline / error). Every
// string resolves from the i18n catalog (P1/S10); spacing + colours come from the generated theme tokens (P1/S9). The
// view performs NO HTTP and owns no store — it binds the [ShareDriveDialogSource] (from the S8 SharingStore) through the
// ViewModel.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/ShareDriveDialog) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed because the file's primary export is the `ShareDriveDialog` composable (matching the filename); the
// co-located [ShareDriveDialogStrings] carrier + the tooling-only previews are supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.sharedrivedialog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.sharing.CreateShareRequest
import io.teslasync.shared.core.presentation.sharing.ShareToken
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private const val EM_DASH = "\u2014"
private const val TITLE_MAX_LINES = 1

/**
 * The already-localized dialog microcopy the composable reads from the i18n catalog (P1/S10). Bundled into one carrier
 * so the stateless [ShareDriveDialogContent] takes plain strings and stays trivially previewable + UI-testable. The
 * `share.expiresOn` line is resolved at its call site because it interpolates the formatted expiry date.
 */
data class ShareDriveDialogStrings(
    val title: String,
    val close: String,
    val description: String,
    val titleHint: String,
    val includeSpeed: String,
    val includeTelemetry: String,
    val expiryLabel: String,
    val expiry7d: String,
    val expiry30d: String,
    val expiry90d: String,
    val expiryNever: String,
    val generate: String,
    val created: String,
    val copy: String,
    val copied: String,
    val copyLink: String,
    val createAnother: String,
    val openLink: String,
    val existing: String,
    val untitled: String,
    val views: String,
    val expired: String,
    val noExpiry: String,
    val revoke: String,
    val emptyMessage: String,
    val loading: String,
    val refresh: String,
)

/** Resolves every [ShareDriveDialogStrings] entry from the surface-owned i18n catalog keys (P1/S10). */
@Composable
fun rememberShareDriveDialogStrings(): ShareDriveDialogStrings =
    ShareDriveDialogStrings(
        title = stringResource(R.string.translation_share_title),
        close = stringResource(R.string.translation_common_close),
        description = stringResource(R.string.translation_share_description),
        titleHint = stringResource(R.string.translation_share_titlePlaceholder), // parity:allow web i18n key name
        includeSpeed = stringResource(R.string.translation_share_includeSpeed),
        includeTelemetry = stringResource(R.string.translation_share_includeTelemetry),
        expiryLabel = stringResource(R.string.translation_share_expiry),
        expiry7d = stringResource(R.string.translation_share_expiry7d),
        expiry30d = stringResource(R.string.translation_share_expiry30d),
        expiry90d = stringResource(R.string.translation_share_expiry90d),
        expiryNever = stringResource(R.string.translation_share_expiryNever),
        generate = stringResource(R.string.translation_share_generate),
        created = stringResource(R.string.translation_share_created),
        copy = stringResource(R.string.translation_share_copy),
        copied = stringResource(R.string.translation_share_copied),
        copyLink = stringResource(R.string.translation_share_copyLink),
        createAnother = stringResource(R.string.translation_share_createAnother),
        openLink = stringResource(R.string.translation_common_open),
        existing = stringResource(R.string.translation_share_existing),
        untitled = stringResource(R.string.translation_share_untitled),
        views = stringResource(R.string.translation_share_views),
        expired = stringResource(R.string.translation_share_expired),
        noExpiry = stringResource(R.string.translation_share_noExpiry),
        revoke = stringResource(R.string.translation_share_revoke),
        emptyMessage = stringResource(R.string.translation_widget_upgrades_noShareLinks),
        loading = stringResource(R.string.translation_common_loading),
        refresh = stringResource(R.string.translation_common_refresh),
    )

/**
 * Stateful entry point — the faithful 1:1 port of the web `ShareDriveDialog({ driveId, open, onClose })`. Renders nothing
 * while [open] is false (the Compose idiom for the web `open` prop, so re-opening enters a fresh composition and clears
 * any stale create-form state), binds the host-provided [source] (from the S8 SharingStore) into a per-drive
 * [ShareDriveDialogViewModel], records the one-shot PII-safe `view.opened` diagnostic on open (P1/S11), clears any stale
 * created-link state from a reused holder, and hosts the modal. No HTTP, no store — the parent owns [onClose] + [source]
 * exactly as the web component's props are.
 *
 * @param open whether the dialog is shown (web `open`).
 * @param driveId the drive being shared (web `driveId`); scopes the feed + keys the holder so distinct drives never share state.
 * @param onClose dismiss callback fired by the close affordance and backdrop/back (web `onClose`).
 * @param source the per-drive data + write seam (host-bound from the shared SharingStore via [bindShareDriveDialogSource]).
 * @param shareBaseUrl the configured public origin used to build the copyable share URL (web `window.location.origin`);
 *   a blank value yields the same-origin relative `/s/{token}` path.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey the holder key; defaults to a per-drive key so each drive's dialog keeps its own state.
 */
@Composable
fun ShareDriveDialog(
    open: Boolean,
    driveId: String,
    onClose: () -> Unit,
    source: ShareDriveDialogSource,
    modifier: Modifier = Modifier,
    shareBaseUrl: String = "",
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = "${ShareDriveDialogRegistration.SLUG}:$driveId",
) {
    if (!open) return
    val viewModel: ShareDriveDialogViewModel =
        viewModel(key = instanceKey, factory = ShareDriveDialogViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    LaunchedEffect(Unit) { viewModel.reset() }

    val sharesState by viewModel.shares.collectAsStateWithLifecycle()
    val creating by viewModel.creating.collectAsStateWithLifecycle()
    val createdToken by viewModel.createdToken.collectAsStateWithLifecycle()
    val revoking by viewModel.revoking.collectAsStateWithLifecycle()
    val strings = rememberShareDriveDialogStrings()
    val uriHandler = LocalUriHandler.current

    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        title = strings.title,
        accessibleName = strings.title,
        closeLabel = strings.close,
    ) {
        ShareDriveDialogContent(
            strings = strings,
            sharesState = sharesState,
            creating = creating,
            createdToken = createdToken,
            revoking = revoking,
            shareBaseUrl = shareBaseUrl,
            onCreate = viewModel::create,
            onCreateAnother = viewModel::createAnother,
            onRevoke = viewModel::revoke,
            onRefresh = viewModel::refresh,
            onOpenLink = { url -> runCatching { uriHandler.openUri(url) } },
        )
    }
}

/**
 * Stateless renderer + create-form-state owner — the unit/UI-test and preview entry point. Owns the ephemeral draft (web
 * `useState`), assembles the create payload through the pure [ShareDriveDialogProjection], and renders either the create
 * form or the created-link result (web `!shareUrl ? form : result`) followed by the existing-share-links section, which
 * reproduces every cache-then-network state (loading / content / empty / stale / offline / error). Every control carries
 * an accessible label; the create controls disable while a create is in flight and each row's revoke disables while that
 * token's revoke runs.
 *
 * @param nowProvider supplies "now" for the per-row expiry comparison; injectable so the expiry branches are deterministic
 *   under test (web `new Date()`).
 */
@Composable
fun ShareDriveDialogContent(
    strings: ShareDriveDialogStrings,
    sharesState: UiState<List<ShareToken>>,
    creating: Boolean,
    createdToken: String?,
    revoking: Set<String>,
    onCreate: (CreateShareRequest) -> Unit,
    onCreateAnother: () -> Unit,
    onRevoke: (String) -> Unit,
    onRefresh: () -> Unit,
    onOpenLink: (String) -> Unit,
    modifier: Modifier = Modifier,
    shareBaseUrl: String = "",
    nowProvider: () -> Long = { System.currentTimeMillis() },
) {
    var draft by remember { mutableStateOf(ShareDraft()) }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        if (createdToken == null) {
            CreateForm(
                strings = strings,
                draft = draft,
                creating = creating,
                onDraftChange = { draft = it },
                onGenerate = { onCreate(ShareDriveDialogProjection.buildCreateRequest(draft)) },
            )
        } else {
            CreatedResult(
                strings = strings,
                url = ShareDriveDialogProjection.shareUrl(shareBaseUrl, createdToken),
                onCreateAnother = onCreateAnother,
                onOpenLink = onOpenLink,
            )
        }

        ExistingSharesSection(
            strings = strings,
            state = sharesState,
            revoking = revoking,
            shareBaseUrl = shareBaseUrl,
            onRevoke = onRevoke,
            onRefresh = onRefresh,
            nowProvider = nowProvider,
        )
    }
}

/** The create form (web `!shareUrl` branch): description, optional title, the two consent toggles, the expiry select, Generate. */
@Composable
private fun CreateForm(
    strings: ShareDriveDialogStrings,
    draft: ShareDraft,
    creating: Boolean,
    onDraftChange: (ShareDraft) -> Unit,
    onGenerate: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        BodyText(strings.description, color = MaterialTheme.colorScheme.onSurfaceVariant)

        Input(
            value = draft.title,
            onValueChange = { onDraftChange(draft.copy(title = it)) },
            label = strings.titleHint,
            enabled = !creating,
        )

        Toggle(
            checked = draft.includeSpeed,
            onCheckedChange = { onDraftChange(draft.copy(includeSpeed = it)) },
            label = strings.includeSpeed,
            enabled = !creating,
        )
        Toggle(
            checked = draft.includeTelemetry,
            onCheckedChange = { onDraftChange(draft.copy(includeTelemetry = it)) },
            label = strings.includeTelemetry,
            enabled = !creating,
        )

        Select(
            options = expiryOptions(strings),
            selectedValue = draft.expiry.wire,
            onSelect = { onDraftChange(draft.copy(expiry = ExpiryOption.fromWire(it))) },
            label = strings.expiryLabel,
            enabled = !creating,
        )

        Button(
            label = strings.generate,
            onClick = onGenerate,
            variant = ButtonVariant.Primary,
            loading = creating,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** The created-link result panel (web `shareUrl` branch): the success line, the read-only URL, copy + open, "create another". */
@Composable
private fun CreatedResult(
    strings: ShareDriveDialogStrings,
    url: String,
    onCreateAnother: () -> Unit,
    onOpenLink: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        BodyText(strings.created, color = TeslaTokens.status.success)

        Input(value = url, onValueChange = {}, readOnly = true)

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CopyButton(
                text = url,
                copyLabel = strings.copy,
                copiedLabel = strings.copied,
                variant = ButtonVariant.Primary,
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = { onOpenLink(url) },
                variant = ButtonVariant.Outline,
            ) {
                Icon(ShareDriveDialogGlyphs.ExternalLink, contentDescription = strings.openLink, size = IconSize.Sm)
            }
        }

        Button(
            label = strings.createAnother,
            onClick = onCreateAnother,
            variant = ButtonVariant.Ghost,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * The "Active Share Links" section (web `shares.length > 0` block, generalised to render every state — no hidden
 * surfaces, per the engineering guideline). A top divider + a header (the section title, a freshness chip, and a refresh
 * affordance) sit above the state body: a spinner while loading (web `sharesLoading`), a `QueryError` retry surface on a
 * hard failure, a friendly empty state when there are no links, or the share rows.
 */
@Composable
private fun ExistingSharesSection(
    strings: ShareDriveDialogStrings,
    state: UiState<List<ShareToken>>,
    revoking: Set<String>,
    shareBaseUrl: String,
    onRevoke: (String) -> Unit,
    onRefresh: () -> Unit,
    nowProvider: () -> Long,
) {
    val locale = Locale.getDefault()
    val dateFormatter =
        remember(locale) {
            DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).withZone(ZoneId.systemDefault())
        }
    val nowMillis = remember(state.fetchedAt) { nowProvider() }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            SectionTitle(strings.existing, modifier = Modifier.weight(1f).semantics { heading() })
            if (!state.isLoading) {
                DataFreshness(
                    updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                    isFetching = state.refreshing,
                    isStale = state.stale,
                    isError = state.hasError,
                    compact = true,
                )
            }
            IconButton(
                imageVector = FeedbackGlyphs.Refresh,
                contentDescription = strings.refresh,
                onClick = onRefresh,
                enabled = !state.refreshing,
                size = IconSize.Sm,
            )
        }

        when {
            state.isLoading ->
                Box(modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.md), contentAlignment = Alignment.Center) {
                    Spinner(size = SpinnerSize.Sm, accessibleLabel = strings.loading)
                }

            state.isError ->
                QueryError(
                    kind = state.toQueryErrorKind(),
                    resourceName = strings.existing,
                    onRetry = onRefresh,
                )

            state.isEmpty ->
                EmptyState(message = strings.emptyMessage, modifier = Modifier.fillMaxWidth())

            else ->
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    (state.data ?: emptyList()).forEach { share ->
                        ShareRow(
                            strings = strings,
                            share = share,
                            url = ShareDriveDialogProjection.shareUrl(shareBaseUrl, share.token),
                            revoking = share.token in revoking,
                            expiryLabel = expiryLabel(strings, share.expiresAt, nowMillis, dateFormatter),
                            onRevoke = { onRevoke(share.token) },
                        )
                    }
                }
        }
    }
}

/** One existing-share row (web `shares.map`): title, view count + expiry status, copy + revoke affordances. */
@Composable
private fun ShareRow(
    strings: ShareDriveDialogStrings,
    share: ShareToken,
    url: String,
    revoking: Boolean,
    expiryLabel: String,
    onRevoke: () -> Unit,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                BodyText(
                    text = share.title ?: strings.untitled,
                    maxLines = TITLE_MAX_LINES,
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                        Icon(
                            TeslaGlyphs.Eye,
                            contentDescription = null,
                            size = IconSize.Xs,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Caption("${share.views} ${strings.views}")
                    }
                    Caption(expiryLabel)
                }
            }
            CopyButton(
                text = url,
                copyLabel = strings.copyLink,
                copiedLabel = strings.copied,
                iconOnly = true,
            )
            IconButton(
                imageVector = ShareDriveDialogGlyphs.Trash,
                contentDescription = strings.revoke,
                onClick = onRevoke,
                enabled = !revoking,
                size = IconSize.Sm,
                tint = TeslaTokens.status.danger,
            )
        }
    }
}

/**
 * The localized expiry status for a row — the web `isExpired ? Expired : share.expires_at ? ExpiresOn(date) : NoExpiry`.
 * The `share.expiresOn` line interpolates the locale/zone-formatted expiry date; an unparseable timestamp formats to the
 * em dash, exactly as the web `formatDate` returns its fallback.
 */
@Composable
private fun expiryLabel(
    strings: ShareDriveDialogStrings,
    expiresAt: String?,
    nowMillis: Long,
    dateFormatter: DateTimeFormatter,
): String =
    when {
        ShareDriveDialogProjection.isExpired(expiresAt, nowMillis) -> strings.expired
        expiresAt != null -> stringResource(R.string.translation_share_expiresOn, formatExpiryDate(dateFormatter, expiresAt))
        else -> strings.noExpiry
    }

/** Locale/zone-aware medium date (web `formatDate` → e.g. "Apr 4, 2025"); an unparseable instant renders the em dash. */
private fun formatExpiryDate(
    formatter: DateTimeFormatter,
    iso: String,
): String = runCatching { formatter.format(Instant.parse(iso)) }.getOrDefault(EM_DASH)

/** The four expiry options, localized (web select `options`). */
private fun expiryOptions(strings: ShareDriveDialogStrings): List<SelectOption> =
    listOf(
        SelectOption(ExpiryOption.Days7.wire, strings.expiry7d),
        SelectOption(ExpiryOption.Days30.wire, strings.expiry30d),
        SelectOption(ExpiryOption.Days90.wire, strings.expiry90d),
        SelectOption(ExpiryOption.Never.wire, strings.expiryNever),
    )

/** Maps the shared [ErrorKind] taxonomy onto the [QueryError] kinds (the localized retry surface), as the sibling surfaces do. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

// ── Previews (tooling-only; each @Preview exercises a render branch the web source defines) ─────────────────────────

private fun previewStrings(): ShareDriveDialogStrings =
    ShareDriveDialogStrings(
        title = "Share Drive",
        close = "Close",
        description = "Generate a public link to share this drive report. Anyone with the link can view it — no login required.",
        titleHint = "Optional title (e.g., \"SF to LA Road Trip\")",
        includeSpeed = "Include speed data",
        includeTelemetry = "Include detailed telemetry (battery, power)",
        expiryLabel = "Link expires after",
        expiry7d = "7 days",
        expiry30d = "30 days",
        expiry90d = "90 days",
        expiryNever = "Never",
        generate = "Generate Link",
        created = "Share link created!",
        copy = "Copy Link",
        copied = "Copied!",
        copyLink = "Copy link",
        createAnother = "Create another link",
        openLink = "Open",
        existing = "Active Share Links",
        untitled = "Untitled share",
        views = "views",
        expired = "Expired",
        noExpiry = "No expiry",
        revoke = "Revoke",
        emptyMessage = "No active share links",
        loading = "Loading…",
        refresh = "Refresh",
    )

private fun previewShares(): List<ShareToken> =
    listOf(
        ShareToken(
            id = 1L,
            token = "abc123",
            driveId = 7L,
            title = "SF to LA Road Trip",
            includeMap = true,
            includeTelemetry = true,
            includeSpeed = true,
            views = 12,
            expiresAt = "2999-01-01T00:00:00Z",
            createdAt = "2025-01-01T00:00:00Z",
        ),
        ShareToken(
            id = 2L,
            token = "def456",
            driveId = 7L,
            title = null,
            includeMap = true,
            includeTelemetry = false,
            includeSpeed = false,
            views = 3,
            expiresAt = null,
            createdAt = "2025-01-02T00:00:00Z",
        ),
    )

@Composable
private fun PreviewHost(content: @Composable () -> Unit) {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.fillMaxWidth().padding(Spacing.md)) { content() }
    }
}

@Preview(name = "Create form + links", showBackground = true, widthDp = 420, heightDp = 760)
@Composable
private fun ShareDriveDialogFormPreview() {
    PreviewHost {
        ShareDriveDialogContent(
            strings = previewStrings(),
            sharesState = UiState(UiPhase.Content, data = previewShares(), fetchedAt = 1_700_000_000_000L),
            creating = false,
            createdToken = null,
            revoking = emptySet(),
            onCreate = {},
            onCreateAnother = {},
            onRevoke = {},
            onRefresh = {},
            onOpenLink = {},
            shareBaseUrl = "https://teslasync.example",
            nowProvider = { 1_700_000_000_000L },
        )
    }
}

@Preview(name = "Created result", showBackground = true, widthDp = 420, heightDp = 640)
@Composable
private fun ShareDriveDialogCreatedPreview() {
    PreviewHost {
        ShareDriveDialogContent(
            strings = previewStrings(),
            sharesState = UiState(UiPhase.Content, data = previewShares(), fetchedAt = 1_700_000_000_000L),
            creating = false,
            createdToken = "newtoken789",
            revoking = emptySet(),
            onCreate = {},
            onCreateAnother = {},
            onRevoke = {},
            onRefresh = {},
            onOpenLink = {},
            shareBaseUrl = "https://teslasync.example",
            nowProvider = { 1_700_000_000_000L },
        )
    }
}

@Preview(name = "Empty links", showBackground = true, widthDp = 420, heightDp = 640)
@Composable
private fun ShareDriveDialogEmptyPreview() {
    PreviewHost {
        ShareDriveDialogContent(
            strings = previewStrings(),
            sharesState = UiState(UiPhase.Empty, data = emptyList(), fetchedAt = 1_700_000_000_000L),
            creating = false,
            createdToken = null,
            revoking = emptySet(),
            onCreate = {},
            onCreateAnother = {},
            onRevoke = {},
            onRefresh = {},
            onOpenLink = {},
            nowProvider = { 1_700_000_000_000L },
        )
    }
}

@Preview(name = "Links error", showBackground = true, widthDp = 420, heightDp = 640)
@Composable
private fun ShareDriveDialogErrorPreview() {
    PreviewHost {
        ShareDriveDialogContent(
            strings = previewStrings(),
            sharesState = UiState(UiPhase.Error, data = null, errorKind = ErrorKind.Network),
            creating = false,
            createdToken = null,
            revoking = emptySet(),
            onCreate = {},
            onCreateAnother = {},
            onRevoke = {},
            onRefresh = {},
            onOpenLink = {},
            nowProvider = { 1_700_000_000_000L },
        )
    }
}
