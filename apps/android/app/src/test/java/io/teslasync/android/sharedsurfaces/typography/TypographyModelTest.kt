package io.teslasync.android.sharedsurfaces.typography

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Typography surface's pure model — the native mirror of every decision the web module
 * makes (web/src/components/ui/Typography.tsx) before it renders text: the role→spec mapping, the heading-level→role
 * mapping, and the granular size→sp scale. Because the composable is a thin render layer over [specForRole] /
 * [headingRole] / [fontSizeSp], the per-branch assertions here double as the surface's per-state snapshot. Runs in the
 * :app:testReleaseUnitTest gate.
 */
class TypographyModelTest {
    // ── The complete token sets are modelled (web typography.role / size / weight / color + heading levels) ──────

    @Test
    fun everyRoleSizeWeightColorAndLevelFromTheWebTokensIsModelled() {
        assertEquals("13 composed roles (web typography.role)", 13, TypographyRole.entries.size)
        assertEquals("8 sizes (web typography.size 2xs…3xl)", 8, TypographySize.entries.size)
        assertEquals("4 weights (web typography.weight)", 4, TypographyWeight.entries.size)
        assertEquals("6 granular colors (web typography.color)", 6, TypographyColor.entries.size)
        assertEquals("4 heading levels (web HeadingLevel)", 4, HeadingLevel.entries.size)
    }

    // ── headingRole: the web HEADING_ROLE record ────────────────────────────────────────────────────────────────

    @Test
    fun headingLevelMapsToItsComposedRole() {
        assertEquals(TypographyRole.PageTitle, headingRole(HeadingLevel.Page))
        assertEquals(TypographyRole.SectionTitle, headingRole(HeadingLevel.Section))
        assertEquals(TypographyRole.PanelTitle, headingRole(HeadingLevel.Panel))
        assertEquals(TypographyRole.Subhead, headingRole(HeadingLevel.Sub))
    }

    // ── specForRole: the per-role snapshot (web typography.role composed class strings) ─────────────────────────

    @Test
    fun specForRoleIsTotalOverEveryRole() {
        // Every role must resolve to a spec with a slot and a color — no role is left unmapped.
        TypographyRole.entries.forEach { role ->
            val spec = specForRole(role)
            assertTrue("slot present for $role", spec.slot in TypeScaleSlot.entries)
            assertTrue("color present for $role", spec.color in RoleColor.entries)
        }
    }

    @Test
    fun headingRolesBindTheTitleSlotsWithTheWebWeights() {
        assertHeadingRole(TypographyRole.PageTitle, TypeScaleSlot.TitleLarge, TypographyWeight.Bold)
        assertHeadingRole(TypographyRole.SectionTitle, TypeScaleSlot.TitleMedium, TypographyWeight.Semibold)
        assertHeadingRole(TypographyRole.PanelTitle, TypeScaleSlot.TitleSmall, TypographyWeight.Semibold)
        assertHeadingRole(TypographyRole.Subhead, TypeScaleSlot.BodyMedium, TypographyWeight.Medium)
    }

    private fun assertHeadingRole(
        role: TypographyRole,
        slot: TypeScaleSlot,
        weight: TypographyWeight,
    ) {
        val spec = specForRole(role)
        assertEquals("slot for $role", slot, spec.slot)
        assertEquals("weight for $role", weight, spec.weight)
        // Page/Section/Panel titles are primary; the subhead is secondary.
        val expectedColor = if (role == TypographyRole.Subhead) RoleColor.Secondary else RoleColor.Primary
        assertEquals("color for $role", expectedColor, spec.color)
        assertFalse("titles are not monospace", spec.mono)
    }

    @Test
    fun bodyRolesAreSecondaryOrPrimaryWithNoWeightOverride() {
        val body = specForRole(TypographyRole.Body)
        assertEquals(TypeScaleSlot.BodyMedium, body.slot)
        assertEquals(RoleColor.Primary, body.color)
        assertNull(body.weight)

        val bodySm = specForRole(TypographyRole.BodySm)
        assertEquals(TypeScaleSlot.BodySmall, bodySm.slot)
        assertEquals(RoleColor.Secondary, bodySm.color)
        assertNull(bodySm.weight)
    }

    @Test
    fun captionAndHelperAreMutedSmallText() {
        listOf(TypographyRole.Caption, TypographyRole.Helper).forEach { role ->
            assertEquals("muted for $role", RoleColor.Muted, specForRole(role).color)
        }
    }

    @Test
    fun labelAndMetricLabelAreMediumMutedLabels() {
        val label = specForRole(TypographyRole.Label)
        assertEquals(TypeScaleSlot.LabelLarge, label.slot)
        assertEquals(RoleColor.Muted, label.color)
        assertEquals(TypographyWeight.Medium, label.weight)

        val metricLabel = specForRole(TypographyRole.MetricLabel)
        assertEquals(TypeScaleSlot.LabelSmall, metricLabel.slot)
        assertEquals(RoleColor.Muted, metricLabel.color)
        assertEquals(TypographyWeight.Medium, metricLabel.weight)
    }

    @Test
    fun metricValueIsBoldWithTabularFigures() {
        val spec = specForRole(TypographyRole.MetricValue)
        assertEquals(TypeScaleSlot.HeadlineMedium, spec.slot)
        assertEquals(RoleColor.Primary, spec.color)
        assertEquals(TypographyWeight.Bold, spec.weight)
        assertTrue("metric value uses tabular figures (web tabular-nums)", spec.tabularFigures)
        assertFalse(spec.mono)
    }

    @Test
    fun codeIsTheOnlyMonospaceRole() {
        val code = specForRole(TypographyRole.Code)
        assertTrue("code is monospace (web font-mono)", code.mono)
        assertEquals(TypeScaleSlot.BodySmall, code.slot)
        // No other role is monospace.
        val monoRoles = TypographyRole.entries.filter { specForRole(it).mono }
        assertEquals(listOf(TypographyRole.Code), monoRoles)
    }

    @Test
    fun errorIsTheOnlyRoleWithTheErrorColor() {
        assertEquals(RoleColor.Error, specForRole(TypographyRole.Error).color)
        val errorRoles = TypographyRole.entries.filter { specForRole(it).color == RoleColor.Error }
        assertEquals(listOf(TypographyRole.Error), errorRoles)
    }

    // ── fontSizeSp: the web Tailwind type scale (text-2xs 10 … text-3xl 30) ─────────────────────────────────────

    @Test
    fun granularSizeMapsToTheWebSpScale() {
        assertEquals(10f, TypographySize.Xs2.fontSizeSp())
        assertEquals(12f, TypographySize.Xs.fontSizeSp())
        assertEquals(14f, TypographySize.Sm.fontSizeSp())
        assertEquals(16f, TypographySize.Base.fontSizeSp())
        assertEquals(18f, TypographySize.Lg.fontSizeSp())
        assertEquals(20f, TypographySize.Xl.fontSizeSp())
        assertEquals(24f, TypographySize.Xl2.fontSizeSp())
        assertEquals(30f, TypographySize.Xl3.fontSizeSp())
    }

    @Test
    fun sizeScaleIsStrictlyIncreasing() {
        val sizes = TypographySize.entries.map { it.fontSizeSp() }
        assertEquals(sizes.sorted(), sizes)
        assertEquals("no two sizes collide", sizes.toSet().size, sizes.size)
    }

    // ── registration / slug contract ───────────────────────────────────────────────────────────────────────────

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("Typography", TYPOGRAPHY_SLUG)
        assertEquals("Typography", TypographyRegistration.SLUG)
        assertEquals("typography", TypographyRegistration.ID)
        assertEquals("tnum", TYPOGRAPHY_TABULAR_FIGURES)
    }
}
