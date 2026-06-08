package io.teslasync.shared.core.units

/**
 * Loads the language-neutral golden fixture (apps/shared/spec/units-golden.json)
 * as raw UTF-8 text. Implemented per test source set because file IO is
 * platform-specific in Kotlin Multiplatform.
 */
internal expect fun readUnitsGoldenJson(): String
