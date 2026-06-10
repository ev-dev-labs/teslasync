package io.teslasync.shared.core.presentation.totp

import java.io.File

internal actual fun readTotpGoldenJson(): String {
    val candidates =
        listOf(
            "spec/totp-golden.json",
            "core/spec/totp-golden.json",
            "apps/shared/core/spec/totp-golden.json",
        )
    for (path in candidates) {
        val f = File(path)
        if (f.exists()) return f.readText(Charsets.UTF_8)
    }
    error(
        "totp-golden.json not found; cwd=${File(".").absolutePath} tried=$candidates",
    )
}
