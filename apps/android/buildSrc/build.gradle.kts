// buildSrc for the Android program (P3/A1). Hosts the deterministic design-token
// generator so the transform lives in compiled, reusable build logic instead of
// inline in app/build.gradle.kts. `kotlin-dsl` gives us Gradle's embedded Kotlin
// plus Groovy (groovy.json.JsonSlurper) with no extra downloads.
plugins {
    `kotlin-dsl`
}

repositories {
    mavenCentral()
}
