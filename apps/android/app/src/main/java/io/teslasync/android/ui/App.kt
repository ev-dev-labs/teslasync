package io.teslasync.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.platform.Platform

/**
 * App root: the Material 3 themed shell. The home screen is an intentionally empty
 * Scaffold with a top app bar (A0 scaffold); pages arrive in later A-phases. The platform
 * line reads from the shared KMP `:core` seam, proving shared-core consumption at runtime.
 */
@Composable
fun App() {
    TeslaSyncTheme {
        HomeScaffold(platformName = remember { Platform.name })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeScaffold(platformName: String) {
    Scaffold(
        topBar = {
            TopAppBar(title = { Text(text = stringResource(R.string.home_title)) })
        },
    ) { innerPadding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
                    .padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = stringResource(R.string.welcome_headline),
                style = MaterialTheme.typography.titleLarge,
            )
            Text(
                text = stringResource(R.string.welcome_body),
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                text = stringResource(R.string.running_on, platformName),
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun HomeScaffoldPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HomeScaffold(platformName = "Android 36")
    }
}
