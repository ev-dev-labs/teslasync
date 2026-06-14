// Off-device unit tests for the ThemePicker ViewModel — drives it over a controllable fake source through
// the real `toUiState` projection, covering the lifecycle the web `ThemeProvider` renders: a first hydrate →
// loading, a resolved selection → content (folded with the static catalogues), a hard read failure → error,
// cached selection after a failed read → the offline (stale + cached) surface, the theme/mode/custom writes
// delegating to the source, a retry re-hydrating, and the PII-safe `view.opened` + select diagnostics. The
// VM's feed is `WhileSubscribed`, so each case keeps an active collector alive on the background scope.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.themepicker

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ThemePickerViewModelTest {
    private class FakeThemePickerSource(
        initial: Resource<ThemeSelection> = Resource.Loading(cached = null, fetchedAt = null, stale = false),
    ) : ThemePickerSource {
        val feed = MutableStateFlow(initial)
        var hydrateCalls: Int = 0
        var lastTheme: String? = null
        var lastMode: String? = null
        var lastCustom: Pair<Long, Long>? = null

        override fun selection(): Flow<Resource<ThemeSelection>> = feed

        override fun hydrate() {
            hydrateCalls++
        }

        override fun setTheme(themeId: String) {
            lastTheme = themeId
        }

        override fun setMode(modeId: String) {
            lastMode = modeId
        }

        override fun setCustomColors(
            primary: Long,
            accent: Long,
        ) {
            lastCustom = primary to accent
        }
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun loadingResolvesToContentFoldedWithCatalogues() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeThemePickerSource()
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)

            source.feed.value = Resource.Success(selection(), fetchedAt = STAMP, stale = false)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(5, state.data?.themes?.size)
            assertEquals(7, state.data?.modes?.size)
            assertEquals("neon-cyan", state.data?.selection?.themeId)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeThemePickerSource(
                    Resource.Error(cached = null, fetchedAt = null, stale = false, error = IllegalStateException("x")),
                )
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)
            assertNotNull(vm.state.value.errorKind)
        }

    @Test
    fun errorWithCachedSelectionKeepsContentAndFlagsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeThemePickerSource(
                    Resource.Error(
                        cached = selection(),
                        fetchedAt = STAMP,
                        stale = true,
                        error = IllegalStateException("read"),
                    ),
                )
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertNotNull(state.errorKind)
            assertTrue(state.isOffline)
        }

    @Test
    fun selectThemeSelectModeAndApplyCustomDelegateToTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeThemePickerSource(Resource.Success(selection(), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)

            vm.selectTheme("tesla-red")
            vm.selectMode("oled")
            vm.applyCustomColors(0xFF010203, 0xFF040506)

            assertEquals("tesla-red", source.lastTheme)
            assertEquals("oled", source.lastMode)
            assertEquals(0xFF010203 to 0xFF040506, source.lastCustom)
        }

    @Test
    fun retryReHydratesTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeThemePickerSource(Resource.Success(selection(), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(1, source.hydrateCalls)

            vm.retry()
            advanceUntilIdle()
            assertEquals(2, source.hydrateCalls)
        }

    @Test
    fun selectThemeEmitsPiiSafeDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeThemePickerSource(Resource.Success(selection(), fetchedAt = STAMP, stale = false)), logger)

            vm.selectTheme("solar-amber")

            val event = logger.events.single { it.first == EVENT_THEME_SELECTED }
            assertEquals(mapOf(FIELD_SURFACE to "ThemePicker"), event.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeThemePickerSource(Resource.Success(selection(), fetchedAt = STAMP, stale = false)), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == EVENT_VIEW_OPENED }
            assertEquals(1, opened.size)
            assertEquals(mapOf(FIELD_SURFACE to "ThemePicker"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: ThemePickerSource,
        logger: Logger = SilentLogger,
    ): ThemePickerViewModel = ThemePickerViewModel(source, logger, backgroundScope)

    private fun TestScope.observe(vm: ThemePickerViewModel) {
        backgroundScope.launch { vm.state.collect {} }
    }

    private fun selection(): ThemeSelection = ThemePickerRegistration.DEFAULTS

    private object SilentLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
