import io.teslasync.android.buildlogic.DesignTokenGenerator
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.io.File

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ktlint)
    alias(libs.plugins.detekt)
}

// apps/design/tokens.json -> generated Material 3 theme Kotlin (P3/A1, ADR-005/ADR-012).
// generateDesignTokens writes Kotlin into apps/design/generated/android/**, which is added
// to the main source set below and consumed by the io.teslasync.android.ui.theme wrappers.
val designTokensJson: File = rootDir.parentFile.resolve("design/tokens.json")
val generatedAndroidRoot: File = rootDir.parentFile.resolve("design/generated/android")

android {
    namespace = "io.teslasync.android"
    compileSdk =
        libs.versions.android.compileSdk
            .get()
            .toInt()

    defaultConfig {
        applicationId = "io.teslasync.android"
        minSdk =
            libs.versions.android.minSdk
                .get()
                .toInt()
        targetSdk =
            libs.versions.android.targetSdk
                .get()
                .toInt()
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Google Maps SDK key (components/maps). Real keys are injected by CI via the
        // MAPS_API_KEY environment variable; local/dev builds default to empty so the
        // build never fails on a missing secret (the base map renders blank without it).
        manifestPlaceholders["MAPS_API_KEY"] = System.getenv("MAPS_API_KEY") ?: "" // parity:allow Gradle manifestPlaceholders DSL name

        // ── OIDC / Authentik public-client configuration (P3/A4, ADR-008) ──────────────
        // The native app is a PUBLIC OAuth client (no secret). Endpoints + client id are
        // deployment-specific (the Authentik client-config runbook is P0/P1 / out of scope here),
        // so they are injected from the environment at build time with sensible self-hosted
        // defaults — the same pattern as MAPS_API_KEY. The redirect scheme registered for the
        // AppAuth redirect receiver is derived from the redirect URI so the two never drift.
        val oidcRedirectUri = System.getenv("TESLASYNC_OIDC_REDIRECT_URI") ?: "io.teslasync.android://oauth2redirect"
        manifestPlaceholders["appAuthRedirectScheme"] = oidcRedirectUri.substringBefore("://") // parity:allow manifestPlaceholders DSL
        buildConfigField("String", "API_BASE_URL", "\"${System.getenv("TESLASYNC_API_BASE_URL") ?: "https://app.teslasync.io"}\"")
        buildConfigField("String", "OIDC_CLIENT_ID", "\"${System.getenv("TESLASYNC_OIDC_CLIENT_ID") ?: "teslasync-android"}\"")
        buildConfigField("String", "OIDC_REDIRECT_URI", "\"$oidcRedirectUri\"")
        buildConfigField(
            "String",
            "OIDC_AUTHORIZATION_ENDPOINT",
            "\"${System.getenv("TESLASYNC_OIDC_AUTHORIZATION_ENDPOINT") ?: "https://auth.teslasync.io/application/o/authorize/"}\"",
        )
        buildConfigField(
            "String",
            "OIDC_TOKEN_ENDPOINT",
            "\"${System.getenv("TESLASYNC_OIDC_TOKEN_ENDPOINT") ?: "https://auth.teslasync.io/application/o/token/"}\"",
        )
        buildConfigField(
            "String",
            "OIDC_REVOCATION_ENDPOINT",
            "\"${System.getenv("TESLASYNC_OIDC_REVOCATION_ENDPOINT") ?: "https://auth.teslasync.io/application/o/revoke/"}\"",
        )
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        compose = true
        // BuildConfig carries the deployment OIDC endpoints + API base URL (see defaultConfig).
        buildConfig = true
    }

    // Compile the generated design-token theme layer (apps/design/generated/android/**)
    // alongside the app sources. It is produced by the generateDesignTokens task.
    sourceSets.getByName("main").java.srcDir(generatedAndroidRoot)

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        // Local (JVM) unit tests exercise the shared :core android actual, whose
        // Platform seam reads android.os.Build / Log; return defaults instead of throwing.
        unitTests.isReturnDefaultValues = true
    }

    lint {
        abortOnError = true
        warningsAsErrors = false
        checkReleaseBuilds = false
        // Path-scoped suppressions for the auto-generated i18n catalog (StringFormatInvalid,
        // MissingQuantity) live in lint.xml so the same checks stay active for app resources.
        lintConfig = file("lint.xml")
        // The shared i18n catalog ships every locale (ar/he) as English fallback
        // (translated=0, fallback=N), so translation-completeness checks are noise here.
        disable += setOf("MissingTranslation", "ExtraTranslation")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

ktlint {
    version.set(libs.versions.ktlintEngine.get())
    filter {
        // The generated design-token layer is machine-authored; lint the hand-written code only.
        exclude { element ->
            val normalizedPath = element.file.path.replace('\\', '/')
            normalizedPath.contains("/design/generated/")
        }
    }
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom(rootDir.resolve("config/detekt/detekt.yml"))
    basePath = rootDir.path
}

// ── Design-token generation (P3/A1) ──────────────────────────────────────────────
val generateDesignTokens by tasks.registering {
    group = "design"
    description = "Generate the Material 3 theme Kotlin layer from apps/design/tokens.json."
    val tokensFile = designTokensJson
    val outDir = generatedAndroidRoot
    inputs.file(tokensFile)
    // No declared output dir: the generated files are committed under apps/design/generated
    // (not build/), and declaring them as a task output makes every source-consuming task
    // (ktlint/lint) require an explicit dependency. Ordering before compile is handled by the
    // preBuild hook below; checkDesignTokensDrift guards that the committed files stay in sync.
    doLast {
        DesignTokenGenerator.generate(tokensFile, outDir)
    }
}

val checkDesignTokensDrift by tasks.registering {
    group = "verification"
    description = "Fail the build if the generated Android theme drifted from tokens.json."
    val tokensFile = designTokensJson
    val outDir = generatedAndroidRoot
    inputs.file(tokensFile)
    doLast {
        val drift = DesignTokenGenerator.drift(tokensFile, outDir)
        if (drift.isNotEmpty()) {
            throw GradleException(
                buildString {
                    append("Generated Android theme drifted from tokens.json; ")
                    append("run `./gradlew :android:generateDesignTokens`:\n")
                    drift.forEach { append("  - ").append(it).append('\n') }
                },
            )
        }
    }
}

// Generated sources must exist before any Kotlin compilation.
tasks.named("preBuild") {
    dependsOn(generateDesignTokens)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material3.window.size)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.vico.compose)
    implementation(libs.vico.compose.m3)
    implementation(libs.maps.compose)
    // OIDC PKCE sign-in via Chrome Custom Tabs + redirect receiver (P3/A4, ADR-008).
    implementation(libs.appauth)
    // Coroutines (Android dispatchers) for the auth state holder + redirect bridge.
    implementation(libs.kotlinx.coroutines.android)
    // SQLDelight runtime — to construct the shared-core offline cache (clear-on-signout, ADR-013).
    implementation(libs.sqldelight.runtime)
    debugImplementation(libs.compose.ui.tooling)

    // KMP shared core (ADR-004), consumed via composite-build substitution (settings.gradle.kts).
    implementation("io.teslasync.shared:core")

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)

    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
