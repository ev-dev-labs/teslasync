// Root build for the shared KMP project (ADR-004). Plugins are resolved here and
// applied in the :core module; the root applies none directly.
plugins {
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.ktlint) apply false
    alias(libs.plugins.kover) apply false
}
