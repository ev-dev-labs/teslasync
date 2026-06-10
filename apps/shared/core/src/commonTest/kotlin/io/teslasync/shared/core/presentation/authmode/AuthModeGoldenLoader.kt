package io.teslasync.shared.core.presentation.authmode

/**
 * Loads the language-neutral AuthMode derivation fixture
 * (apps/shared/core/spec/auth-mode-golden.json) as raw UTF-8 text. Implemented per test source
 * set because file IO is platform-specific in Kotlin Multiplatform.
 */
internal expect fun readAuthModeGoldenJson(): String
