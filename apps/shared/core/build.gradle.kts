import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.android.library)
    alias(libs.plugins.ktlint)
    alias(libs.plugins.sqldelight)
}

kotlin {
    // ADR-004: stable, intentional public API for the framework consumed by Apple/Android.
    explicitApi()

    compilerOptions {
        // Generated DTOs (P1/S2) model timestamps with the new kotlin.time.Instant.
        optIn.add("kotlin.time.ExperimentalTime")
        freeCompilerArgs.add("-Xexpect-actual-classes")
    }

    androidTarget {
        @OptIn(ExperimentalKotlinGradlePluginApi::class)
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
        }
    }

    val appleTargets = listOf(
        iosArm64(),
        iosSimulatorArm64(),
        macosArm64(),
    )

    // Apple consumes the core as a single static XCFramework named "Shared" (ADR-004).
    val sharedXcf = XCFramework("Shared")
    appleTargets.forEach { target ->
        target.binaries.framework {
            baseName = "Shared"
            isStatic = true
            sharedXcf.add(this)
        }
    }

    sourceSets {
        commonMain.dependencies {
            // Declared now; consumed by later S-phases (net/SSE/units/cache).
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.kotlinx.datetime)
            implementation(libs.ktor.client.core)
            // P1/S4 networking foundation: JSON content negotiation for the resilient client.
            implementation(libs.ktor.client.content.negotiation)
            implementation(libs.ktor.serialization.kotlinx.json)
            // P1/S7 offline cache (ADR-013): typed SQLDelight runtime for the shared cache.
            implementation(libs.sqldelight.runtime)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            // P1/S4: in-memory engine so tests hit no real network. Suspend tests run on a
            // real dispatcher (expect/actual runBlocking) — virtual-time runners interact
            // badly with the engine's async dispatch and the request-timeout race.
            implementation(libs.ktor.client.mock)
            // P1/S4 SSE: virtual-clock test dispatcher for deterministic reconnect +
            // staleness transitions (no real waiting).
            implementation(libs.kotlinx.coroutines.test)
        }
        androidMain.dependencies {
            implementation(libs.ktor.client.okhttp)
            // P1/S7: Android SQLite driver backing the offline cache.
            implementation(libs.sqldelight.android.driver)
        }
        appleMain.dependencies {
            implementation(libs.ktor.client.darwin)
            // P1/S7: native SQLite driver backing the offline cache on Apple targets.
            implementation(libs.sqldelight.native.driver)
        }
        // P1/S7: android unit tests (JVM) use the in-memory JDBC driver — no real DB file.
        val androidUnitTest by getting {
            dependencies {
                implementation(libs.sqldelight.sqlite.driver)
            }
        }
    }
}

android {
    namespace = "io.teslasync.shared.core"
    compileSdk = libs.versions.android.compileSdk.get().toInt()

    defaultConfig {
        minSdk = libs.versions.android.minSdk.get().toInt()
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        // commonTest runs as an Android local (JVM) unit test; let stubbed
        // android.* framework calls (e.g. Log.d) return defaults instead of throwing.
        unitTests.isReturnDefaultValues = true
    }
}

// The XCFramework("Shared") DSL above registers the `assembleSharedXCFramework`
// task used by the gate; no extra wiring needed here.

// P1/S7 offline cache (ADR-013): one typed SQLDelight database shared by every
// platform. Generated into build/generated (excluded from ktlint).
sqldelight {
    databases {
        create("TeslaSyncCache") {
            packageName.set("io.teslasync.shared.core.cache.db")
        }
    }
}

ktlint {
    version.set(libs.versions.ktlintEngine.get())
    filter {
        // Generated API models/endpoints (P1/S2) are not hand-written source.
        exclude { it.file.path.replace('\\', '/').contains("/generated/") }
    }
}
