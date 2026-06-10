package io.teslasync.shared.core.presentation.logstream

import java.io.File

internal actual fun readLogStreamGoldenJson(): String {
    val candidates =
        listOf(
            "spec/log-stream-golden.json",
            "core/spec/log-stream-golden.json",
            "apps/shared/core/spec/log-stream-golden.json",
        )
    for (path in candidates) {
        val f = File(path)
        if (f.exists()) return f.readText(Charsets.UTF_8)
    }
    error(
        "log-stream-golden.json not found; cwd=${File(".").absolutePath} tried=$candidates",
    )
}
