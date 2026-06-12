using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>Accordion</c> shared surface's UI-thread-free logic — the registration
/// metadata (slug, the title / icon / border token keys, the corner key, the body reveal duration, the collapsed
/// / expanded chevron rotation and the default <c>px-4 py-3</c> padding), the padding value type
/// (<see cref="AccordionPadding"/>), the render model + its defaults / overrides (<see cref="AccordionModel"/>),
/// the pure <see cref="AccordionProjection"/> across the collapsed / expanded states and the icon / badge /
/// header-extra branches, the composed accessible-name contract (the title) + the test-id passthrough, the
/// reduce-motion body-fade adapter (<see cref="AccordionMotion"/>), the controlled-or-uncontrolled open-state
/// holder with its reactive notifications (<see cref="AccordionViewModel"/>), the PII-safe diagnostics, and the
/// argument guards. Mirrors the web spec one-for-one (<c>web/src/components/ui/Accordion.tsx</c>). The WinUI view
/// itself (shared-surfaces/Accordion.cs, which composes the tokenized disclosure + header + body) is exercised by
/// the app build. Because the component reads no network data and resolves no inherent i18n keys (its title /
/// badge / header-extra are caller-supplied, already-localized content), there is no loading / error / stale /
/// offline state and no i18n catalogue dependency; the reproduced branches are collapsed vs. expanded, the
/// optional icon / badge / header-extra, the controlled vs. uncontrolled open state and the reduced-motion vs.
/// animated body reveal.
/// </summary>
public sealed class AccordionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static AccordionDisplay Project(AccordionModel model, bool isOpen) =>
        AccordionProjection.Project(model, isOpen, Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Accordion", AccordionRegistration.Slug);

    [Fact]
    public void Registration_token_keys_match_the_web_css_variables()
    {
        // web title text-[var(--text-primary)], icon text-[var(--text-muted)], outer border-white/[0.06].
        Assert.Equal("TsColorTextPrimaryBrush", AccordionRegistration.TitleBrushKey);
        Assert.Equal("TsColorTextMutedBrush", AccordionRegistration.IconBrushKey);
        Assert.Equal("TsColorBorderBrush", AccordionRegistration.BorderBrushKey);
    }

    [Fact]
    public void Registration_corner_key_is_the_rounded_xl_token() =>
        Assert.Equal("TsRadiusMd", AccordionRegistration.CornerRadiusKey);

    [Fact]
    public void Registration_body_reveal_duration_matches_the_web_framer_motion()
    {
        // web transition={{ duration: 0.2 }} -> 200 ms.
        Assert.Equal(200, AccordionRegistration.BodyRevealDurationMs);
    }

    [Fact]
    public void Registration_chevron_rotation_matches_the_web_rotate_180()
    {
        Assert.Equal(0, AccordionRegistration.ChevronCollapsedRotationDegrees);
        Assert.Equal(180, AccordionRegistration.ChevronExpandedRotationDegrees);
    }

    [Fact]
    public void Registration_default_padding_matches_the_web_px4_py3() =>
        Assert.Equal(AccordionPadding.Symmetric(16, 12), AccordionRegistration.DefaultContentPadding);

    // ── padding value type ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Padding_symmetric_sets_matching_horizontal_and_vertical_insets()
    {
        AccordionPadding p = AccordionPadding.Symmetric(16, 12);

        Assert.Equal(16, p.Left);
        Assert.Equal(12, p.Top);
        Assert.Equal(16, p.Right);
        Assert.Equal(12, p.Bottom);
    }

    [Fact]
    public void Padding_uniform_sets_every_side()
    {
        AccordionPadding p = AccordionPadding.Uniform(8);

        Assert.Equal(new AccordionPadding(8, 8, 8, 8), p);
    }

    // ── model defaults / overrides ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Model_create_defaults_to_a_collapsed_titled_section_with_no_slots()
    {
        AccordionModel m = AccordionModel.Create("Battery health");

        Assert.Equal("Battery health", m.Title);
        Assert.Null(m.IconGlyph);
        Assert.False(m.HasBadge);
        Assert.False(m.HasHeaderExtra);
        Assert.False(m.DefaultOpen);
        Assert.Equal(AccordionRegistration.DefaultContentPadding, m.HeaderPadding);
        Assert.Equal(AccordionRegistration.DefaultContentPadding, m.BodyPadding);
        Assert.Null(m.TestId);
    }

    [Fact]
    public void Model_create_carries_every_supplied_field()
    {
        AccordionPadding header = AccordionPadding.Symmetric(20, 10);
        AccordionPadding body = AccordionPadding.Uniform(4);
        AccordionModel m = AccordionModel.Create(
            "Advanced",
            iconGlyph: "\uE713",
            hasBadge: true,
            hasHeaderExtra: true,
            defaultOpen: true,
            headerPadding: header,
            bodyPadding: body,
            testId: "advanced-section");

        Assert.Equal("\uE713", m.IconGlyph);
        Assert.True(m.HasBadge);
        Assert.True(m.HasHeaderExtra);
        Assert.True(m.DefaultOpen);
        Assert.Equal(header, m.HeaderPadding);
        Assert.Equal(body, m.BodyPadding);
        Assert.Equal("advanced-section", m.TestId);
    }

    [Fact]
    public void Model_empty_is_a_collapsed_untitled_section()
    {
        Assert.Equal(string.Empty, AccordionModel.Empty.Title);
        Assert.False(AccordionModel.Empty.DefaultOpen);
    }

    // ── projection: parity visual constants ───────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_visual_constants_match_the_web_tailwind_scale()
    {
        Assert.Equal(16, AccordionProjection.IconSize);          // web h-4 w-4
        Assert.Equal(14, AccordionProjection.TitleFontSize);     // web text-sm
        Assert.Equal(12, AccordionProjection.HeaderItemSpacing); // web gap-3
    }

    // ── projection: collapsed vs expanded (web open && ...) ───────────────────────────────────────────────

    [Fact]
    public void Projection_collapsed_hides_the_body_and_points_the_chevron_at_zero()
    {
        AccordionDisplay d = Project(AccordionModel.Create("Title"), isOpen: false);

        Assert.False(d.IsOpen);
        Assert.False(d.IsBodyVisible);
        Assert.Equal(0, d.ChevronRotationDegrees);
    }

    [Fact]
    public void Projection_expanded_reveals_the_body_and_rotates_the_chevron()
    {
        AccordionDisplay d = Project(AccordionModel.Create("Title"), isOpen: true);

        Assert.True(d.IsOpen);
        Assert.True(d.IsBodyVisible);
        Assert.Equal(180, d.ChevronRotationDegrees);
    }

    // ── projection: icon branch (web icon && ...) ─────────────────────────────────────────────────────────

    [Fact]
    public void Projection_icon_is_absent_by_default()
    {
        AccordionDisplay d = Project(AccordionModel.Create("Title"), isOpen: false);

        Assert.False(d.HasIcon);
        Assert.Null(d.IconGlyph);
    }

    [Fact]
    public void Projection_icon_is_rendered_when_a_glyph_is_supplied()
    {
        AccordionDisplay d = Project(AccordionModel.Create("Title", iconGlyph: "\uE713"), isOpen: false);

        Assert.True(d.HasIcon);
        Assert.Equal("\uE713", d.IconGlyph);
        Assert.Equal("TsColorTextMutedBrush", d.IconBrushKey);
    }

    // ── projection: badge + header-extra slots (web {badge} / {headerExtra}) ──────────────────────────────

    [Fact]
    public void Projection_badge_slot_follows_the_model()
    {
        Assert.False(Project(AccordionModel.Create("Title"), false).HasBadge);
        Assert.True(Project(AccordionModel.Create("Title", hasBadge: true), false).HasBadge);
    }

    [Fact]
    public void Projection_header_extra_slot_follows_the_model()
    {
        Assert.False(Project(AccordionModel.Create("Title"), false).HasHeaderExtra);
        Assert.True(Project(AccordionModel.Create("Title", hasHeaderExtra: true), false).HasHeaderExtra);
    }

    // ── projection: title + container tokens ──────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_carries_the_title_and_container_tokens()
    {
        AccordionDisplay d = Project(AccordionModel.Create("Charging"), isOpen: false);

        Assert.Equal("Charging", d.Title);
        Assert.Equal("TsColorTextPrimaryBrush", d.TitleBrushKey);
        Assert.Equal("TsColorBorderBrush", d.BorderBrushKey);
        Assert.Equal("TsRadiusMd", d.CornerRadiusKey);
    }

    // ── projection: padding passthrough (web headerClassName / bodyClassName) ─────────────────────────────

    [Fact]
    public void Projection_passes_through_the_header_and_body_padding()
    {
        AccordionPadding header = AccordionPadding.Symmetric(20, 10);
        AccordionPadding body = AccordionPadding.Uniform(4);
        AccordionModel m = AccordionModel.Create("Title", headerPadding: header, bodyPadding: body);

        AccordionDisplay d = Project(m, isOpen: true);

        Assert.Equal(header, d.HeaderPadding);
        Assert.Equal(body, d.BodyPadding);
    }

    // ── accessibility: the disclosure is named by the title ───────────────────────────────────────────────

    [Fact]
    public void Accessible_name_is_the_title()
    {
        Assert.Equal("Battery health", Project(AccordionModel.Create("Battery health"), false).AutomationName);
        Assert.Equal("Battery health", Project(AccordionModel.Create("Battery health"), true).AutomationName);
    }

    // ── test hook (testId -> AutomationProperties.AutomationId) ───────────────────────────────────────────

    [Fact]
    public void Test_id_is_passed_through_as_the_automation_id()
    {
        Assert.Equal("cells", Project(AccordionModel.Create("Title", testId: "cells"), false).AutomationId);
        Assert.Null(Project(AccordionModel.Create("Title"), false).AutomationId);
    }

    // ── reduce-motion body-fade adapter (web prefers-reduced-motion) ──────────────────────────────────────

    [Fact]
    public void Motion_full_motion_uses_the_web_two_hundred_ms_reveal()
    {
        Assert.Equal(200, AccordionMotion.BodyRevealDurationMs(reduceMotion: false));
        Assert.True(AccordionMotion.ShouldAnimateBody(reduceMotion: false));
    }

    [Fact]
    public void Motion_reduced_motion_collapses_the_reveal_to_zero()
    {
        Assert.Equal(0, AccordionMotion.BodyRevealDurationMs(reduceMotion: true));
        Assert.False(AccordionMotion.ShouldAnimateBody(reduceMotion: true));
    }

    // ── view-model: uncontrolled (web useState(defaultOpen)) ──────────────────────────────────────────────

    [Fact]
    public void ViewModel_slug_matches_the_web_surface() =>
        Assert.Equal("Accordion", AccordionViewModel.Slug);

    [Fact]
    public void ViewModel_uncontrolled_seeds_from_default_open()
    {
        Assert.False(new AccordionViewModel(defaultOpen: false).IsControlled);
        Assert.False(new AccordionViewModel(defaultOpen: false).IsOpen);
        Assert.True(new AccordionViewModel(defaultOpen: true).IsOpen);
    }

    [Fact]
    public void ViewModel_uncontrolled_request_open_mutates_and_announces()
    {
        var vm = new AccordionViewModel(defaultOpen: false);
        var changed = new List<string>();
        var opens = new List<bool>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName ?? string.Empty);
        vm.OpenChanged += (_, open) => opens.Add(open);

        vm.RequestOpen(true);

        Assert.True(vm.IsOpen);
        Assert.Equal(nameof(AccordionViewModel.IsOpen), Assert.Single(changed));
        Assert.True(Assert.Single(opens));
    }

    [Fact]
    public void ViewModel_uncontrolled_request_open_is_idempotent()
    {
        var vm = new AccordionViewModel(defaultOpen: false);
        var opens = new List<bool>();
        vm.OpenChanged += (_, open) => opens.Add(open);

        vm.RequestOpen(false);

        Assert.False(vm.IsOpen);
        Assert.Empty(opens);
    }

    [Fact]
    public void ViewModel_uncontrolled_toggle_flips_the_state()
    {
        var vm = new AccordionViewModel(defaultOpen: false);

        vm.Toggle();
        Assert.True(vm.IsOpen);

        vm.Toggle();
        Assert.False(vm.IsOpen);
    }

    [Fact]
    public void ViewModel_uncontrolled_ignores_sync_controlled_open()
    {
        var vm = new AccordionViewModel(defaultOpen: false);
        var opens = new List<bool>();
        vm.OpenChanged += (_, open) => opens.Add(open);

        vm.SyncControlledOpen(true);

        Assert.False(vm.IsOpen);
        Assert.Empty(opens);
    }

    // ── view-model: controlled (web isControlled = open !== undefined && onOpenChange !== undefined) ───────

    [Fact]
    public void ViewModel_is_controlled_only_when_both_value_and_callback_are_supplied()
    {
        Assert.True(new AccordionViewModel(false, controlledOpen: false, onOpenChange: _ => { }).IsControlled);
        Assert.False(new AccordionViewModel(false, controlledOpen: true, onOpenChange: null).IsControlled);
        Assert.False(new AccordionViewModel(false, controlledOpen: null, onOpenChange: _ => { }).IsControlled);
    }

    [Fact]
    public void ViewModel_controlled_resolves_open_from_the_parent_value()
    {
        // web: open = isControlled ? openProp : internalOpen — defaultOpen is ignored when controlled.
        var vm = new AccordionViewModel(defaultOpen: false, controlledOpen: true, onOpenChange: _ => { });

        Assert.True(vm.IsControlled);
        Assert.True(vm.IsOpen);
    }

    [Fact]
    public void ViewModel_controlled_request_open_only_notifies_the_parent()
    {
        var notified = new List<bool>();
        var announced = new List<bool>();
        var vm = new AccordionViewModel(defaultOpen: false, controlledOpen: false, onOpenChange: notified.Add);
        vm.OpenChanged += (_, open) => announced.Add(open);

        vm.RequestOpen(true);

        // The parent owns the truth: the callback fires but IsOpen does not change until the parent syncs back.
        Assert.True(Assert.Single(notified));
        Assert.False(vm.IsOpen);
        Assert.Empty(announced);
    }

    [Fact]
    public void ViewModel_controlled_sync_reflects_the_new_parent_value()
    {
        var vm = new AccordionViewModel(defaultOpen: false, controlledOpen: false, onOpenChange: _ => { });
        var changed = new List<string>();
        var opens = new List<bool>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName ?? string.Empty);
        vm.OpenChanged += (_, open) => opens.Add(open);

        vm.SyncControlledOpen(true);

        Assert.True(vm.IsOpen);
        Assert.Equal(nameof(AccordionViewModel.IsOpen), Assert.Single(changed));
        Assert.True(Assert.Single(opens));
    }

    [Fact]
    public void ViewModel_controlled_sync_is_idempotent()
    {
        var vm = new AccordionViewModel(defaultOpen: false, controlledOpen: true, onOpenChange: _ => { });
        var opens = new List<bool>();
        vm.OpenChanged += (_, open) => opens.Add(open);

        vm.SyncControlledOpen(true);

        Assert.Empty(opens);
    }

    [Fact]
    public void ViewModel_controlled_toggle_requests_the_inverse_from_the_parent()
    {
        var notified = new List<bool>();
        var vm = new AccordionViewModel(defaultOpen: false, controlledOpen: true, onOpenChange: notified.Add);

        vm.Toggle();

        // open is true (controlled), so the toggle requests false from the parent without changing IsOpen.
        Assert.False(Assert.Single(notified));
        Assert.True(vm.IsOpen);
    }

    // ── diagnostics (view.opened, PII-safe — never the title or body) ─────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AccordionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Accordion", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new AccordionDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<System.ArgumentNullException>(() => AccordionProjection.Project(null!, false, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(
            () => AccordionProjection.Project(AccordionModel.Empty, false, null!));

    [Fact]
    public void Model_create_rejects_a_null_title() =>
        Assert.Throws<System.ArgumentNullException>(() => AccordionModel.Create(null!));
}
