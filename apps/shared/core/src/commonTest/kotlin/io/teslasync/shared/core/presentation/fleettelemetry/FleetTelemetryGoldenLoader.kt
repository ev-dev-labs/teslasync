package io.teslasync.shared.core.presentation.fleettelemetry

/**
 * Loads the language-neutral Fleet-Telemetry coverage derivation fixture
 * (apps/shared/core/spec/fleet-telemetry-coverage-golden.json) as raw UTF-8 text. Implemented per
 * test source set because file IO is platform-specific in Kotlin Multiplatform.
 */
internal expect fun readFleetTelemetryCoverageGoldenJson(): String
