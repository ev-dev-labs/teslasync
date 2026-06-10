package io.teslasync.shared.core.presentation.authmode

import java.io.File

internal actual fun readAuthModeGoldenJson(): String {
    val candidates =
        listOf(
            "spec/auth-mode-golden.json",
            "core/spec/auth-mode-golden.json",
            "apps/shared/core/spec/auth-mode-golden.json",
        )
    for (path in candidates) {
        val f = File(path)
        if (f.exists()) return f.readText(Charsets.UTF_8)
    }
    error(
        "auth-mode-golden.json not found; cwd=${File(".").absolutePath} tried=$candidates",
    )
}
