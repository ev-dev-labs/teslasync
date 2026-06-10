package io.teslasync.shared.core.presentation.apihealth

import java.io.File

internal actual fun readApiHealthGoldenJson(): String {
    val candidates =
        listOf(
            "spec/api-health-golden.json",
            "core/spec/api-health-golden.json",
            "apps/shared/core/spec/api-health-golden.json",
        )
    for (path in candidates) {
        val f = File(path)
        if (f.exists()) return f.readText(Charsets.UTF_8)
    }
    error(
        "api-health-golden.json not found; cwd=${File(".").absolutePath} tried=$candidates",
    )
}
