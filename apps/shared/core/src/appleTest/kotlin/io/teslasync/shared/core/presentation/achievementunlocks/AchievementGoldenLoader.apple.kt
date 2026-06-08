package io.teslasync.shared.core.presentation.achievementunlocks

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.convert
import kotlinx.cinterop.toKString
import kotlinx.cinterop.usePinned
import platform.posix.SEEK_END
import platform.posix.SEEK_SET
import platform.posix.fclose
import platform.posix.fopen
import platform.posix.fread
import platform.posix.fseek
import platform.posix.ftell

@OptIn(ExperimentalForeignApi::class)
internal actual fun readAchievementUnlocksGoldenJson(): String {
    val candidates =
        listOf(
            "spec/achievement-unlocks-golden.json",
            "core/spec/achievement-unlocks-golden.json",
            "apps/shared/core/spec/achievement-unlocks-golden.json",
        )
    for (path in candidates) {
        val file = fopen(path, "rb") ?: continue
        try {
            fseek(file, 0, SEEK_END)
            val size = ftell(file)
            fseek(file, 0, SEEK_SET)
            if (size <= 0) continue
            val buffer = ByteArray(size.toInt())
            buffer.usePinned { pinned ->
                fread(pinned.addressOf(0), 1.convert(), size.convert(), file)
            }
            return buffer.toKString()
        } finally {
            fclose(file)
        }
    }
    error("achievement-unlocks-golden.json not found (apple test host)")
}
