package io.teslasync.shared.core.units

import java.io.File

internal actual fun readUnitsGoldenJson(): String {
    // `:core:testDebugUnitTest` runs with the module dir (apps/shared/core) as the
    // working directory; the fixture lives one level up under spec/. Probe a few
    // candidates so the loader also works from the repo root or apps/shared.
    val candidates =
        listOf(
            "../spec/units-golden.json",
            "spec/units-golden.json",
            "apps/shared/spec/units-golden.json",
        )
    for (path in candidates) {
        val f = File(path)
        if (f.exists()) return f.readText(Charsets.UTF_8)
    }
    error(
        "units-golden.json not found; cwd=${File(".").absolutePath} tried=$candidates",
    )
}
