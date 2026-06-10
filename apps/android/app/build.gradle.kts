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
    debugImplementation(libs.compose.ui.tooling)

    // KMP shared core (ADR-004), consumed via composite-build substitution (settings.gradle.kts).
    implementation("io.teslasync.shared:core")

    testImplementation(libs.junit)

    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
