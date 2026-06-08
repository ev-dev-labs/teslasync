package io.teslasync.shared.core.presentation.apihealth

/**
 * Loads the language-neutral ApiHealth derivation fixture
 * (apps/shared/core/spec/api-health-golden.json) as raw UTF-8 text. Implemented per test
 * source set because file IO is platform-specific in Kotlin Multiplatform.
 */
internal expect fun readApiHealthGoldenJson(): String
