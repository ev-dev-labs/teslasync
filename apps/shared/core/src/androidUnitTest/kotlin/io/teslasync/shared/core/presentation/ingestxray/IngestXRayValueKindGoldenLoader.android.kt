package io.teslasync.shared.core.presentation.ingestxray

import java.io.File

internal actual fun readIngestXRayValueKindGoldenJson(): String {
    val candidates =
        listOf(
            "spec/ingest-xray-value-kind-golden.json",
            "core/spec/ingest-xray-value-kind-golden.json",
            "apps/shared/core/spec/ingest-xray-value-kind-golden.json",
        )
    for (path in candidates) {
        val f = File(path)
        if (f.exists()) return f.readText(Charsets.UTF_8)
    }
    error(
        "ingest-xray-value-kind-golden.json not found; cwd=${File(".").absolutePath} tried=$candidates",
    )
}
