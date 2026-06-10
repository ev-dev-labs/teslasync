package io.teslasync.shared.core.presentation.sessions

import java.io.File

internal actual fun readSessionsGoldenJson(): String {
    val candidates =
        listOf(
            "spec/sessions-golden.json",
            "core/spec/sessions-golden.json",
            "apps/shared/core/spec/sessions-golden.json",
        )
    for (path in candidates) {
        val f = File(path)
        if (f.exists()) return f.readText(Charsets.UTF_8)
    }
    error(
        "sessions-golden.json not found; cwd=${File(".").absolutePath} tried=$candidates",
    )
}
