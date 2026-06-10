package io.teslasync.shared.core.presentation.sessions

/**
 * Loads the language-neutral Sessions derivation fixture (apps/shared/core/spec/sessions-golden.json)
 * as raw UTF-8 text. Implemented per test source set because file IO is platform-specific in Kotlin
 * Multiplatform.
 */
internal expect fun readSessionsGoldenJson(): String
