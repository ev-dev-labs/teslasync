package io.teslasync.shared.core.presentation.ingestxray

/**
 * Loads the language-neutral Ingest X-Ray value-kind derivation fixture
 * (apps/shared/core/spec/ingest-xray-value-kind-golden.json) as raw UTF-8 text. Implemented per
 * test source set because file IO is platform-specific in Kotlin Multiplatform.
 */
internal expect fun readIngestXRayValueKindGoldenJson(): String
