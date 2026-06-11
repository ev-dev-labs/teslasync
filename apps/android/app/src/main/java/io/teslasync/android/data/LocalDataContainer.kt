package io.teslasync.android.data

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel

/**
 * CompositionLocal exposing the process [DataContainer] to the Compose tree, so A7 page Composables
 * obtain their ViewModels (and the live [UnitFormatter] / [SelectedVehicleStore]) without prop-drilling
 * the container. Provided once at the app root (App.kt), alongside `LocalAuthController`.
 */
val LocalDataContainer =
    staticCompositionLocalOf<DataContainer> {
        error("LocalDataContainer not provided — wrap the screen in CompositionLocalProvider(LocalDataContainer provides ...).")
    }

/**
 * Obtains a data-layer [ViewModel] of type [VM] from the [LocalDataContainer]'s factory, scoped by
 * `viewModel()` to the current navigation entry / activity. This is the single entry point A7 pages
 * use to bind to a ViewModel, then collect its state with `collectAsStateWithLifecycle`:
 *
 *     val viewModel: DashboardViewModel = dataViewModel()
 *     val state by viewModel.stats.collectAsStateWithLifecycle()
 */
@Composable
inline fun <reified VM : ViewModel> dataViewModel(): VM = viewModel(factory = LocalDataContainer.current.viewModelFactory)
