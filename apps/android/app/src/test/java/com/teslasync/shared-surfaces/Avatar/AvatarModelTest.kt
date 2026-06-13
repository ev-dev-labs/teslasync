// Off-device unit coverage for the Avatar surface's pure model (P3 acceptance: adapter + per-state +
// a11y-label tests). Pins the seed → hue mapping to the web djb2 reference (web
// src/components/data-display/Avatar.tsx), the initials extraction, the attribution + seed selection, the
// content classifier across every render branch (image / initials / user-glyph / bot-glyph / anonymous), the
// tooltip + merged TalkBack labels, and the PII-safe `view.opened` diagnostic. No Compose / Android framework
// / HTTP — runs in :android:testReleaseUnitTest. Reference values are exactly what the web component produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.avatar

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AvatarModelTest {
    // ── registration metadata mirrors the prompt-mandated surface slug + palette contract ───

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("Avatar", AVATAR_SLUG)
    }

    @Test
    fun paletteSizeMirrorsOkabeIto() {
        // The Okabe-Ito CB-safe palette (web CHART_COLORS_CB_SAFE) has eight hues; the token list must match.
        assertEquals(8, OKABE_ITO_PALETTE_SIZE)
    }

    // ── djb2 hash pinned to the web reference (unsigned >>> 0) ───────────────────────

    @Test
    fun djb2MatchesWebReference() {
        assertEquals(1765120808L, djb2("user-1"))
        assertEquals(4288693480L, djb2("John Doe"))
        assertEquals(2088856121L, djb2("Cher"))
        assertEquals(5862283L, djb2("JD"))
        assertEquals(193409669L, djb2("abc"))
        assertEquals(177562L, djb2("?"))
        assertEquals(2943393127L, djb2("vehicle-7"))
    }

    @Test
    fun colorIndexMatchesWebReference() {
        assertEquals(0, avatarColorIndex("user-1"))
        assertEquals(0, avatarColorIndex("John Doe"))
        assertEquals(1, avatarColorIndex("Cher"))
        assertEquals(3, avatarColorIndex("JD"))
        assertEquals(5, avatarColorIndex("abc"))
        assertEquals(2, avatarColorIndex("?"))
        assertEquals(7, avatarColorIndex("vehicle-7"))
    }

    @Test
    fun colorIndexIsStableAndInRange() {
        val first = avatarColorIndex("Alice")
        assertEquals(first, avatarColorIndex("Alice"))
        assertTrue(first in 0 until OKABE_ITO_PALETTE_SIZE)
    }

    @Test
    fun colorIndexGuardsNonPositivePalette() {
        assertEquals(0, avatarColorIndex("anything", 0))
    }

    // ── initials (web avatarInitials) ───────────────────────────────────────────────

    @Test
    fun initialsTakeFirstTwoWordInitials() {
        assertEquals("JD", avatarInitials("John Doe"))
    }

    @Test
    fun initialsTakeTwoCharsOfSingleWord() {
        assertEquals("CH", avatarInitials("Cher"))
        assertEquals("X", avatarInitials("X"))
    }

    @Test
    fun initialsUppercaseAndCollapseWhitespace() {
        assertEquals("AB", avatarInitials("  alice   bob "))
        assertEquals("JD", avatarInitials("john doe"))
    }

    @Test
    fun initialsFallBackToQuestionMark() {
        assertEquals("?", avatarInitials(null))
        assertEquals("?", avatarInitials(""))
        assertEquals("?", avatarInitials("   "))
    }

    // ── seed + attribution (web seed / isAttributed) ────────────────────────────────

    @Test
    fun seedPrefersUserIdThenTrimmedName() {
        assertEquals("u1", avatarSeed("u1", "John"))
        assertEquals("John", avatarSeed(null, "  John "))
        assertEquals("John", avatarSeed("", "John"))
        assertEquals("?", avatarSeed(null, "   "))
        assertEquals("?", avatarSeed(null, null))
    }

    @Test
    fun attributionRequiresNameOrUserId() {
        assertTrue(isAttributed("u1", null))
        assertTrue(isAttributed(null, "John"))
        assertFalse(isAttributed(null, null))
        assertFalse(isAttributed("", "   "))
    }

    // ── content classifier: every render branch / state ─────────────────────────────

    @Test
    fun resolveImageWhenSrcPresentAndNotFailed() {
        val visual = resolveAvatarVisual(AvatarIdentity(src = "https://x/a.png", name = "John"), imageFailed = false)
        assertEquals(AvatarContent.Image("https://x/a.png"), visual.content)
        assertTrue(visual.attributed)
    }

    @Test
    fun resolveFallsBackToInitialsWhenImageFailed() {
        val visual = resolveAvatarVisual(AvatarIdentity(src = "https://x/a.png", name = "John Doe"), imageFailed = true)
        assertEquals(AvatarContent.Initials("JD"), visual.content)
    }

    @Test
    fun resolveInitialsWhenNamePresentNoImage() {
        val visual = resolveAvatarVisual(AvatarIdentity(name = "Cher"), imageFailed = false)
        assertEquals(AvatarContent.Initials("CH"), visual.content)
        assertTrue(visual.attributed)
    }

    @Test
    fun resolveUserGlyphWhenAnonymous() {
        val visual = resolveAvatarVisual(AvatarIdentity(), imageFailed = false)
        assertEquals(AvatarContent.Glyph(AvatarKind.User), visual.content)
        assertFalse(visual.attributed)
    }

    @Test
    fun resolveBotGlyphWhenAnonymousBot() {
        val visual = resolveAvatarVisual(AvatarIdentity(kind = AvatarKind.Bot), imageFailed = false)
        assertEquals(AvatarContent.Glyph(AvatarKind.Bot), visual.content)
        assertFalse(visual.attributed)
    }

    @Test
    fun resolveGlyphAttributedWhenUserIdButNoName() {
        val visual = resolveAvatarVisual(AvatarIdentity(userId = "u-9"), imageFailed = false)
        assertEquals(AvatarContent.Glyph(AvatarKind.User), visual.content)
        assertTrue(visual.attributed)
        assertEquals(avatarColorIndex("u-9"), visual.colorIndex)
    }

    // ── tooltip + merged accessibility labels (web tooltipLabel + status aria-label) ─

    @Test
    fun tooltipLabelUsesNameOrUnknownFallback() {
        assertEquals("John Doe", avatarTooltipLabel("  John Doe ", "Unknown user"))
        assertEquals("Unknown user", avatarTooltipLabel(null, "Unknown user"))
        assertEquals("Unknown user", avatarTooltipLabel("   ", "Unknown user"))
    }

    @Test
    fun accessibilityLabelFoldsNameAndStatus() {
        assertEquals("John Doe, Online", avatarAccessibilityLabel("John Doe", "Unknown user", "Online"))
        assertEquals("Unknown user", avatarAccessibilityLabel(null, "Unknown user", null))
        assertEquals("Unknown user, Offline", avatarAccessibilityLabel(" ", "Unknown user", "Offline"))
    }

    // ── diagnostics: one PII-safe view.opened ───────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        recordAvatarOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no user id, name, or image URL can leak through the diagnostic.
        assertEquals(mapOf("surface" to "Avatar"), records[0].fields)
    }
}
