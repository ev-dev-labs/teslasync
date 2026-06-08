package io.teslasync.shared.core.presentation.settings

import io.teslasync.shared.core.data.repo.apiSuspendBody
import io.teslasync.shared.core.data.repo.carPreferencesQuery
import io.teslasync.shared.core.data.repo.gasPriceConfigBody
import io.teslasync.shared.core.data.repo.gasPriceToggleBody
import io.teslasync.shared.core.data.repo.settingsCarPrefsKey
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Golden vectors locking the pure request-shape derivations ported from the web `useSettings`
 * domain (web/src/api/hooks/useSettings.ts): the `/user-preferences/latest?vehicle_id=` query, the
 * three `JSON.stringify` mutation bodies, and the per-vehicle car-prefs cache key. The vectors are
 * language-neutral (typed inputs in / resolved snake_case wire shape out) so the C# Windows port and
 * the KMP core load the identical set and cannot drift (ADR-004). They are inlined here (rather than
 * a separate `apps/shared/core/spec` file + per-source-set loader) to match the lightweight
 * `OperatorConfidenceAuditLogQueryGoldenTest` precedent; the C# port mirrors these exact rows.
 *
 * Web contract reproduced verbatim:
 *  - `carPreferencesQuery` emits a single unconditional `vehicle_id` param (the web template
 *    `?vehicle_id=${vehicleId}`), stringified;
 *  - `gasPriceToggleBody` → `{"enabled":<bool>}` (web `JSON.stringify({ enabled })`);
 *  - `gasPriceConfigBody` → `{"poll_interval":"<str>"}` (web `JSON.stringify({ poll_interval })`);
 *  - `apiSuspendBody` → `{"suspended":<bool>}` (web `JSON.stringify({ suspended })`);
 *  - `settingsCarPrefsKey` → `car-prefs:<id>` (the web `settingsKeys.carPrefs(vehicleId)` tuple).
 */
class SettingsDerivationsGoldenTest {
    @Test
    fun carPreferencesQueryEmitsSingleSnakeCaseVehicleId() {
        assertEquals(mapOf("vehicle_id" to "1"), carPreferencesQuery(1))
        assertEquals(mapOf("vehicle_id" to "42"), carPreferencesQuery(42))
        assertEquals(mapOf("vehicle_id" to "0"), carPreferencesQuery(0))
        // Single key, exact snake_case name (never camelCase) — the backend contract.
        assertEquals(listOf("vehicle_id"), carPreferencesQuery(7).keys.toList())
    }

    @Test
    fun gasPriceToggleBodyMatchesWebStringify() {
        assertEquals("""{"enabled":true}""", gasPriceToggleBody(true).toString())
        assertEquals("""{"enabled":false}""", gasPriceToggleBody(false).toString())
    }

    @Test
    fun gasPriceConfigBodyMatchesWebStringify() {
        assertEquals("""{"poll_interval":"1h"}""", gasPriceConfigBody("1h").toString())
        assertEquals("""{"poll_interval":""}""", gasPriceConfigBody("").toString())
        assertEquals("""{"poll_interval":"30m"}""", gasPriceConfigBody("30m").toString())
    }

    @Test
    fun apiSuspendBodyMatchesWebStringify() {
        assertEquals("""{"suspended":true}""", apiSuspendBody(true).toString())
        assertEquals("""{"suspended":false}""", apiSuspendBody(false).toString())
    }

    @Test
    fun carPrefsKeyIsPerVehicle() {
        assertEquals("car-prefs:1", settingsCarPrefsKey(1))
        assertEquals("car-prefs:99", settingsCarPrefsKey(99))
        // Distinct vehicles cache independently.
        assertEquals(false, settingsCarPrefsKey(1) == settingsCarPrefsKey(2))
    }
}
