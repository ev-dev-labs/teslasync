package io.teslasync.shared.core.presentation.achievementunlocks

import java.io.File

internal actual fun readAchievementUnlocksGoldenJson(): String {
    val candidates =
        listOf(
            "spec/achievement-unlocks-golden.json",
            "core/spec/achievement-unlocks-golden.json",
            "apps/shared/core/spec/achievement-unlocks-golden.json",
        )
    for (path in candidates) {
        val f = File(path)
        if (f.exists()) return f.readText(Charsets.UTF_8)
    }
    error(
        "achievement-unlocks-golden.json not found; cwd=${File(".").absolutePath} tried=$candidates",
    )
}
