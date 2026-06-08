package io.teslasync.shared.core.presentation.achievementunlocks

/**
 * Loads the language-neutral AchievementUnlocks derivation fixture
 * (apps/shared/spec/achievement-unlocks-golden.json) as raw UTF-8 text.
 * Implemented per test source set because file IO is platform-specific in KMP.
 */
internal expect fun readAchievementUnlocksGoldenJson(): String
