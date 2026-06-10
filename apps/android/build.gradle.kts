// Root build for the Android program. Plugins are resolved here and applied in the
// :android app module; the root applies none directly (ADR-012 version lock via catalog).
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.ktlint) apply false
}
