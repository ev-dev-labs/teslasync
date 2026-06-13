// The native Jetpack Compose + Material 3 NavigationGuardProvider shared surface — a parity port of
// web/src/components/feedback/NavigationGuardProvider.tsx. The web source is an in-app unsaved-changes GUARD: a
// React context exposing `register` + `confirmIfDirty`, a provider that intercepts browser back/forward
// (popstate) when any registered form is dirty, and a `<ConfirmDialog>` whose answer resolves an awaited promise
// (discard = navigate, keep editing = stay). This file is the composable binding; every pure decision lives in
// NavigationGuardProviderModel.kt.
//
// Element-for-element mapping of the web API:
//   • `createContext<NavigationGuardContextValue | null>(null)` → [LocalNavigationGuard], a CompositionLocal
//     defaulting to `null` so a guarded-navigation helper rendered outside any provider keeps working unchanged.
//   • `<NavigationGuardProvider>` (the guards map + `pending` state + `confirmIfDirty` + the popstate listener +
//     the rendered `<ConfirmDialog>`) → [NavigationGuardProvider]: a `remember`ed [NavigationGuardCoordinator]
//     provided to the tree, a [BackHandler] reproducing the popstate interception, and the reused native
//     [ConfirmDialog] surface (the native counterpart of the web `@/components/ui/ConfirmDialog`).
//   • `useNavigationGuardContext()` → [useNavigationGuardContext]; the web `NOOP_CTX` →
//     [NoopNavigationGuardController].
//
// Back interception (the platform-idiomatic analogue of the web popstate handler): on Android the system back is
// the analogue of browser back/forward. A [BackHandler] intercepts it; while it is enabled the user's back press
// is routed through [NavigationGuardCoordinator.confirmIfDirty] instead of popping immediately. The web rolls the
// URL back AFTER popstate fires (popstate is post-navigation) and replays `navigate(-1)` on discard, guarded by
// `skipNextPopstateRef`; Android's [BackHandler] fires BEFORE the pop, so no URL rollback is needed — on discard
// the intercepted back is replayed by disabling the handler (the `bypassNextBack` flag, the native
// `skipNextPopstateRef`) and re-dispatching through the back dispatcher, and on keep-editing nothing happens (the
// screen never left). This documented divergence is the only honest way to map a post-navigation web event onto a
// pre-navigation platform callback (Honesty Covenant #9). Like the web provider — which takes only `children` —
// the surface self-handles back with no host wiring.
//
// `MatchingDeclarationName` is suppressed for the co-located reader hook + private composables;
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/NavigationGuardProvider) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path, exactly as the sibling shared surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.navigationguardprovider

import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.modalsdialogs.confirmdialog.ConfirmDialog
import io.teslasync.android.modalsdialogs.confirmdialog.ConfirmVariant
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.launch

/**
 * The navigation-guard context exposed to the Compose tree — the native port of the web
 * `createContext<NavigationGuardContextValue | null>(null)`. Defaults to `null` so a [useNavigationGuardContext]
 * call (or a guarded-navigation helper) rendered outside any [NavigationGuardProvider] keeps working unchanged,
 * resolving to [NoopNavigationGuardController]. Read it through [useNavigationGuardContext].
 */
val LocalNavigationGuard: ProvidableCompositionLocal<NavigationGuardController?> = staticCompositionLocalOf { null }

/**
 * Provides in-app unsaved-changes guarding to the entire [content] subtree — the native port of the web
 * `<NavigationGuardProvider>`. Mount it once, high in the tree (under the nav host), so every screen, guarded
 * link, and system-back press is covered.
 *
 * It `remember`s one [NavigationGuardCoordinator] (the guards registry + `pending` confirm state), provides it
 * through [LocalNavigationGuard], intercepts the system back with a [BackHandler] (the platform analogue of the
 * web popstate listener), and renders the reused [ConfirmDialog] whenever a guard blocks a navigation — its
 * Discard / Keep-editing choice resolving the awaited `confirmIfDirty()`. A one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) fires on first composition. Performs NO HTTP.
 *
 * @param logger the sanctioned redacting logger the `view.opened` diagnostic + the embedded dialog route through;
 *   defaults to the app's [LocalDataContainer] (a test passes a capturing logger).
 * @param content the subtree guarded by this provider.
 */
@Composable
fun NavigationGuardProvider(
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    val coordinator = remember { NavigationGuardCoordinator() }
    val surface by coordinator.surface.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { recordNavigationGuardProviderOpened(logger) }

    InterceptSystemBack(coordinator)

    CompositionLocalProvider(LocalNavigationGuard provides coordinator) {
        content()
        NavigationGuardConfirmHost(
            surface = surface,
            onConfirm = coordinator::confirm,
            onCancel = coordinator::cancel,
            logger = logger,
        )
    }
}

/**
 * Reads the current navigation-guard context — the native port of the web `useNavigationGuardContext()`. Returns
 * [NoopNavigationGuardController] outside any [NavigationGuardProvider] (web `ctx ?? NOOP_CTX`) so consumers and
 * guarded-navigation helpers register + confirm unconditionally without crashing.
 */
@Composable
fun useNavigationGuardContext(): NavigationGuardController = LocalNavigationGuard.current ?: NoopNavigationGuardController

/**
 * Routes the system back through the guard — the platform analogue of the web popstate handler. While enabled the
 * [BackHandler] intercepts every back press and asks [NavigationGuardCoordinator.confirmIfDirty]; a clean screen
 * resolves `true` immediately and the back is replayed, while a dirty screen surfaces the confirm dialog and only
 * replays the back on discard. The replay disables this handler for one dispatch ([bypassNextBack], the native
 * `skipNextPopstateRef`) and re-dispatches through the back dispatcher so the intercepted back is not re-prompted.
 */
@Composable
private fun InterceptSystemBack(coordinator: NavigationGuardCoordinator) {
    val scope = rememberCoroutineScope()
    var bypassNextBack by remember { mutableStateOf(false) }
    val backDispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher

    BackHandler(enabled = !bypassNextBack) {
        scope.launch {
            if (coordinator.confirmIfDirty()) {
                bypassNextBack = true
            }
        }
    }

    LaunchedEffect(bypassNextBack) {
        if (bypassNextBack) {
            backDispatcher?.onBackPressed()
            bypassNextBack = false
        }
    }
}

/**
 * Renders the unsaved-changes confirmation when the surface is [NavigationGuardSurface.Confirming] — the native
 * port of the web `<ConfirmDialog open={pending != null} variant="warning" silenceKey="unsaved-navigation" …>`,
 * reusing the native [ConfirmDialog] surface (the counterpart of the web `@/components/ui/ConfirmDialog`). The
 * blocking guard's own localized message is shown, falling back to the generic warning (web `pending?.message ??
 * t('forms.unsavedWarning')`). [NavigationGuardSurface.Idle] draws nothing — the provider only wraps its children.
 * Every label resolves through the P1/S10 catalog; no English literal lives here.
 */
@Composable
private fun NavigationGuardConfirmHost(
    surface: NavigationGuardSurface,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    logger: Logger,
) {
    when (surface) {
        NavigationGuardSurface.Idle -> Unit
        is NavigationGuardSurface.Confirming -> {
            val fallback = stringResource(R.string.translation_forms_unsavedWarning)
            ConfirmDialog(
                title = stringResource(R.string.translation_forms_unsavedTitle),
                message = surface.message ?: fallback,
                confirmLabel = stringResource(R.string.translation_forms_discard),
                cancelLabel = stringResource(R.string.translation_forms_keepEditing),
                onConfirm = onConfirm,
                onCancel = onCancel,
                variant = ConfirmVariant.Warning,
                silenceKey = UNSAVED_NAVIGATION_SILENCE_KEY,
                logger = logger,
            )
        }
    }
}

// ── Previews (tooling-only; the dialog branch is the meaningful visual) ─────────────────────────────────────

/** A logger that records nothing — keeps the @Preview render free of the [LocalDataContainer] dependency. */
private object PreviewLogger : Logger {
    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) = Unit
}

@Preview(name = "Unsaved-changes prompt (generic message)", showBackground = true, widthDp = 360)
@Composable
private fun NavigationGuardGenericPromptPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NavigationGuardConfirmHost(
            surface = NavigationGuardSurface.Confirming(message = null),
            onConfirm = {},
            onCancel = {},
            logger = PreviewLogger,
        )
    }
}

@Preview(name = "Unsaved-changes prompt (per-guard message)", showBackground = true, widthDp = 360)
@Composable
private fun NavigationGuardCustomPromptPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NavigationGuardConfirmHost(
            surface = NavigationGuardSurface.Confirming(message = "You have an unsaved automation."),
            onConfirm = {},
            onCancel = {},
            logger = PreviewLogger,
        )
    }
}
