@file:Suppress("UnstableApiUsage")

pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
    }
}

rootProject.name = "teslasync-android"

// The single app module. Its Gradle path is `:android` (every P3/A* prompt gate
// addresses `:android:`); the sources live under `app/` to keep res/values* in place.
include(":android")
project(":android").projectDir = file("app")

// Consume the KMP shared core (apps/shared, ADR-004) as a Gradle module via a
// composite build. The shared build is self-contained (its own catalog + wrapper)
// and outside this artifact's allowed files, so it is reused verbatim. Dependency
// substitution maps the requested coordinate to the `:core` project of the included
// build — realizing the prompt's `project(":core")` intent across builds, so the app
// depends on the real shared core end to end.
includeBuild("../shared") {
    dependencySubstitution {
        substitute(module("io.teslasync.shared:core")).using(project(":core"))
    }
}
