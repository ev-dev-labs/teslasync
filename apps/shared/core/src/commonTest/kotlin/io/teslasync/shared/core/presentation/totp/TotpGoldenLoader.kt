package io.teslasync.shared.core.presentation.totp

/**
 * Loads the language-neutral TOTP derivation fixture (apps/shared/core/spec/totp-golden.json) as raw
 * UTF-8 text. Implemented per test source set because file IO is platform-specific in Kotlin
 * Multiplatform.
 */
internal expect fun readTotpGoldenJson(): String
