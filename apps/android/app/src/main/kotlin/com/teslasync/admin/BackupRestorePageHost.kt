// Page-host wiring for the BackupRestorePage admin surface (A7) — the seam that attaches real screen content to
// the surface's navigation id. It mirrors the sibling admin hosts (e.g.
// [io.teslasync.android.admin.users.UsersPageHost]): [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]. [BackupRestoreRoute] reads the app DI graph from
// [LocalDataContainer], binds the page to the shared resilient client via [asBackupRestorePageSource], and
// performs no HTTP itself.
//
// The Android navigation registry ([io.teslasync.android.navigation.Destinations]) is generated from the
// canonical web route taxonomy and frozen by a coverage test; the web `/backup` route is not in that generated
// set, so adding a Destinations row would break the parity lock. This registration is therefore forward-ready and
// dormant: [io.teslasync.android.navigation.TeslaSyncNavHost] only renders ids present in `Destinations`, so the
// content lights up automatically once a follow-up lands the route, mirroring the web page's own routing status.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.backuprestore

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry for the BackupRestorePage surface. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared resilient [io.teslasync.shared.core.net.ApiHttpClient]
 * (the backup endpoints inherit its `/api/v1` prefixing, retry, breaker, and 401 refresh), and binds the page to
 * the app's redacting logger.
 */
@Composable
fun BackupRestoreRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.api.asBackupRestorePageSource() }
    BackupRestorePage(source = source, logger = container.logger)
}

/**
 * Registers the [BackupRestoreRoute] host for the surface's reserved navigation id. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op. The
 * registration is dormant until a follow-up adds the matching `Destinations` row (the web `/backup` route is not
 * in the generated registry).
 */
object BackupRestorePageHost {
    private val id: String = BackupRestorePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { BackupRestoreRoute() }
    }
}
