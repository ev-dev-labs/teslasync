package io.teslasync.shared.core.presentation.fleettelemetry

import java.io.File

internal actual fun readFleetTelemetryCoverageGoldenJson(): String {
    val candidates =
        listOf(
            "spec/fleet-telemetry-coverage-golden.json",
            "core/spec/fleet-telemetry-coverage-golden.json",
            "apps/shared/core/spec/fleet-telemetry-coverage-golden.json",
        )
    for (path in candidates) {
        val f = File(path)
        if (f.exists()) return f.readText(Charsets.UTF_8)
    }
    error(
        "fleet-telemetry-coverage-golden.json not found; cwd=${File(".").absolutePath} tried=$candidates",
    )
}
