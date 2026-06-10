package io.teslasync.shared.core.presentation.logstream

/**
 * Loads the language-neutral LogStream derivation fixture
 * (apps/shared/core/spec/log-stream-golden.json) as raw UTF-8 text. Implemented per
 * test source set because file IO is platform-specific in KMP.
 */
internal expect fun readLogStreamGoldenJson(): String
