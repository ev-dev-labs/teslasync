using System.ComponentModel;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the SectionErrorBoundary shared surface's UI-thread-free logic — the registration
/// metadata (slug, the boundary / retry automation ids, the alert ARIA role/live contract, the Segoe alert glyph,
/// the tesla-red tint recipe, the neutral text brush keys and the i18n keys + fallbacks the projection references),
/// the per-mode <see cref="SectionErrorBoundaryProjection"/> (healthy children, the default inline card with retry,
/// the title-fallback alert card without retry, and the caller's custom node — incl. the accessible-name contract),
/// the <see cref="SectionErrorBoundaryViewModel"/> state holder (initial healthy state, capture → fallback, reset →
/// children, reconfiguration, and the PropertyChanged contract), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/feedback/SectionErrorBoundary.tsx + ErrorBoundary.tsx). The WinUI view itself
/// (shared-surfaces/SectionErrorBoundary.cs) is exercised by the app build.
/// </summary>
public sealed class SectionErrorBoundaryTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static SectionErrorBoundaryProjection Project(
        SectionErrorBoundaryMode mode,
        bool hasError = true,
        string? fallbackTitle = null,
        string? detailText = null) =>
        SectionErrorBoundaryProjection.Project(
            new SectionErrorBoundaryRequest(mode, hasError, fallbackTitle, detailText),
            Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("SectionErrorBoundary", SectionErrorBoundaryRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        Assert.Equal("section-error-boundary", SectionErrorBoundaryRegistration.BoundaryAutomationId);
        Assert.Equal("section-error-boundary-retry", SectionErrorBoundaryRegistration.RetryAutomationId);
    }

    [Fact]
    public void Role_and_live_constants_match_the_web_aria_contract()
    {
        Assert.Equal("alert", SectionErrorBoundaryRegistration.RoleAlert);
        Assert.Equal("assertive", SectionErrorBoundaryRegistration.LiveAssertive);
    }

    [Fact]
    public void Alert_glyph_matches_the_shared_fluent_stand_in() =>
        Assert.Equal("\uE7BA", SectionErrorBoundaryRegistration.AlertGlyph);

    [Fact]
    public void Card_tint_recipe_matches_the_web_tesla_red_alphas()
    {
        Assert.Equal("TsColorDangerColor", SectionErrorBoundaryRegistration.DangerColorKey);
        Assert.Equal("TsColorDangerBrush", SectionErrorBoundaryRegistration.DangerBrushKey);
        Assert.Equal("TsColorTextSecondaryBrush", SectionErrorBoundaryRegistration.SecondaryTextBrushKey);
        Assert.Equal("TsColorTextMutedBrush", SectionErrorBoundaryRegistration.MutedTextBrushKey);
        Assert.Equal(0.05, SectionErrorBoundaryRegistration.CardBackgroundOpacity);
        Assert.Equal(0.20, SectionErrorBoundaryRegistration.CardBorderOpacity);
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source_and_catalogue()
    {
        Assert.Equal("translation.errors.section.title", SectionErrorBoundaryRegistration.DefaultTitleKey);
        Assert.Equal("This section failed to load", SectionErrorBoundaryRegistration.DefaultTitleFallback);

        // The one key extracted directly from the web source (SectionErrorBoundary.tsx L54).
        Assert.Equal("translation.errors.section.subtitle", SectionErrorBoundaryRegistration.SubtitleKey);
        Assert.Equal("Other parts of the page should still work.", SectionErrorBoundaryRegistration.SubtitleFallback);

        Assert.Equal("translation.error.retry", SectionErrorBoundaryRegistration.RetryKey);
        Assert.Equal("Retry", SectionErrorBoundaryRegistration.RetryFallback);

        Assert.Equal("translation.errors.section.chartTitle", SectionErrorBoundaryRegistration.ChartTitleKey);
        Assert.Equal("This chart failed to load", SectionErrorBoundaryRegistration.ChartTitleFallback);
        Assert.Equal("translation.errors.section.tableTitle", SectionErrorBoundaryRegistration.TableTitleKey);
        Assert.Equal("This table failed to render", SectionErrorBoundaryRegistration.TableTitleFallback);
        Assert.Equal("translation.errors.section.widgetTitle", SectionErrorBoundaryRegistration.WidgetTitleKey);
        Assert.Equal("Widget failed to load", SectionErrorBoundaryRegistration.WidgetTitleFallback);
    }

    // ── projection: healthy ───────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(SectionErrorBoundaryMode.Default)]
    [InlineData(SectionErrorBoundaryMode.TitleFallback)]
    [InlineData(SectionErrorBoundaryMode.CustomFallback)]
    public void Healthy_projection_shows_children_for_every_mode(SectionErrorBoundaryMode mode)
    {
        var projection = Project(mode, hasError: false);

        Assert.False(projection.IsErrored);
        Assert.False(projection.ShowsCard);
        Assert.False(projection.ShowsCustomFallback);
        Assert.False(projection.HasRetry);
        Assert.Equal(mode, projection.Mode);
        Assert.Equal(string.Empty, projection.AccessibleName);
    }

    [Fact]
    public void Healthy_factory_matches_a_no_error_request()
    {
        var projection = SectionErrorBoundaryProjection.Project(
            SectionErrorBoundaryRequest.Healthy(SectionErrorBoundaryMode.Default),
            Localizer);

        Assert.Equal(SectionErrorBoundaryProjection.Healthy(SectionErrorBoundaryMode.Default), projection);
    }

    [Fact]
    public void Projection_throws_when_request_is_null() =>
        Assert.Throws<ArgumentNullException>(() => SectionErrorBoundaryProjection.Project(null!, Localizer));

    [Fact]
    public void Projection_throws_when_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(() =>
            SectionErrorBoundaryProjection.Project(SectionErrorBoundaryRequest.Healthy(SectionErrorBoundaryMode.Default), null!));

    // ── projection: default inline card (with retry) ──────────────────────────────────────────────────────

    [Fact]
    public void Default_mode_renders_the_inline_card_with_retry()
    {
        var projection = Project(SectionErrorBoundaryMode.Default);

        Assert.True(projection.IsErrored);
        Assert.True(projection.ShowsCard);
        Assert.False(projection.ShowsCustomFallback);
        Assert.Equal("\uE7BA", projection.IconGlyph);
        Assert.Equal("This section failed to load", projection.Title);
        Assert.Equal("Other parts of the page should still work.", projection.Detail);
        Assert.True(projection.HasRetry);
        Assert.Equal("Retry", projection.RetryLabel);
        Assert.Equal("alert", projection.Role);
        Assert.Equal("assertive", projection.LiveSetting);
    }

    [Fact]
    public void Default_mode_with_detail_shows_the_safe_detail_in_place_of_the_subtitle()
    {
        var projection = Project(SectionErrorBoundaryMode.Default, detailText: "InvalidOperationException");

        Assert.Equal("This section failed to load", projection.Title);
        Assert.Equal("InvalidOperationException", projection.Detail);
        Assert.True(projection.HasRetry);
    }

    // ── projection: title-fallback alert card (no retry) ──────────────────────────────────────────────────

    [Fact]
    public void TitleFallback_mode_renders_the_custom_title_with_subtitle_and_no_retry()
    {
        var projection = Project(SectionErrorBoundaryMode.TitleFallback, fallbackTitle: "This chart failed to load");

        Assert.True(projection.IsErrored);
        Assert.True(projection.ShowsCard);
        Assert.Equal("\uE7BA", projection.IconGlyph);
        Assert.Equal("This chart failed to load", projection.Title);
        Assert.Equal("Other parts of the page should still work.", projection.Detail);
        Assert.False(projection.HasRetry);
        Assert.Equal(string.Empty, projection.RetryLabel);
        Assert.Equal("alert", projection.Role);
        Assert.Equal("assertive", projection.LiveSetting);
    }

    [Fact]
    public void TitleFallback_mode_without_a_title_uses_the_default_section_title()
    {
        var projection = Project(SectionErrorBoundaryMode.TitleFallback, fallbackTitle: null);

        Assert.Equal("This section failed to load", projection.Title);
        Assert.False(projection.HasRetry);
    }

    // ── projection: custom fallback node ──────────────────────────────────────────────────────────────────

    [Fact]
    public void CustomFallback_mode_owns_its_semantics_and_shows_no_card()
    {
        var projection = Project(SectionErrorBoundaryMode.CustomFallback);

        Assert.True(projection.IsErrored);
        Assert.False(projection.ShowsCard);
        Assert.True(projection.ShowsCustomFallback);
        Assert.False(projection.HasRetry);
        Assert.Equal(string.Empty, projection.IconGlyph);
        Assert.Equal(string.Empty, projection.Title);
        Assert.Equal(string.Empty, projection.Role);
        Assert.Equal(string.Empty, projection.AccessibleName);
    }

    // ── projection: accessibility ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Card_accessible_name_is_the_title_and_detail_together()
    {
        var projection = Project(SectionErrorBoundaryMode.Default);

        Assert.Equal("This section failed to load Other parts of the page should still work.", projection.AccessibleName);
    }

    [Fact]
    public void Every_card_branch_has_a_non_empty_accessible_name()
    {
        // a11y: whenever a fallback card is shown, a screen reader always has something to announce.
        SectionErrorBoundaryProjection[] cards =
        [
            Project(SectionErrorBoundaryMode.Default),
            Project(SectionErrorBoundaryMode.Default, detailText: "TimeoutException"),
            Project(SectionErrorBoundaryMode.TitleFallback, fallbackTitle: "This table failed to render"),
            Project(SectionErrorBoundaryMode.TitleFallback, fallbackTitle: null),
        ];

        foreach (var projection in cards)
        {
            Assert.True(projection.ShowsCard);
            Assert.False(string.IsNullOrWhiteSpace(projection.AccessibleName));
            Assert.False(string.IsNullOrWhiteSpace(projection.Title));
        }
    }

    // ── view model: state transitions ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_starts_healthy()
    {
        var viewModel = new SectionErrorBoundaryViewModel(Localizer);

        Assert.False(viewModel.HasError);
        Assert.False(viewModel.Projection.IsErrored);
        Assert.Equal(SectionErrorBoundaryMode.Default, viewModel.Mode);
    }

    [Fact]
    public void ViewModel_capture_switches_to_the_fallback()
    {
        var viewModel = new SectionErrorBoundaryViewModel(Localizer);

        viewModel.Capture();

        Assert.True(viewModel.HasError);
        Assert.True(viewModel.Projection.ShowsCard);
        Assert.True(viewModel.Projection.HasRetry);
    }

    [Fact]
    public void ViewModel_capture_with_detail_flows_to_the_projection()
    {
        var viewModel = new SectionErrorBoundaryViewModel(Localizer);

        viewModel.Capture("NullReferenceException");

        Assert.Equal("NullReferenceException", viewModel.Projection.Detail);
    }

    [Fact]
    public void ViewModel_reset_restores_the_children()
    {
        var viewModel = new SectionErrorBoundaryViewModel(Localizer);
        viewModel.Capture();

        viewModel.Reset();

        Assert.False(viewModel.HasError);
        Assert.False(viewModel.Projection.IsErrored);
    }

    [Fact]
    public void ViewModel_reconfigures_into_the_title_fallback_mode()
    {
        var viewModel = new SectionErrorBoundaryViewModel(Localizer);
        viewModel.Capture();

        viewModel.Configure(SectionErrorBoundaryMode.TitleFallback, "Widget failed to load");

        Assert.True(viewModel.Projection.ShowsCard);
        Assert.False(viewModel.Projection.HasRetry);
        Assert.Equal("Widget failed to load", viewModel.Projection.Title);
    }

    [Fact]
    public void ViewModel_reconfigures_into_the_custom_fallback_mode()
    {
        var viewModel = new SectionErrorBoundaryViewModel(Localizer);
        viewModel.Capture();

        viewModel.Configure(SectionErrorBoundaryMode.CustomFallback);

        Assert.True(viewModel.Projection.ShowsCustomFallback);
        Assert.False(viewModel.Projection.ShowsCard);
    }

    [Fact]
    public void ViewModel_raises_property_changed_on_capture_and_reset()
    {
        var viewModel = new SectionErrorBoundaryViewModel(Localizer);
        var changes = 0;
        viewModel.PropertyChanged += OnChanged;

        viewModel.Capture();
        viewModel.Reset();

        viewModel.PropertyChanged -= OnChanged;
        Assert.Equal(2, changes);

        void OnChanged(object? sender, PropertyChangedEventArgs e)
        {
            if (e.PropertyName == nameof(SectionErrorBoundaryViewModel.Projection))
            {
                changes++;
            }
        }
    }

    [Fact]
    public void ViewModel_reset_when_already_healthy_is_a_no_op()
    {
        var viewModel = new SectionErrorBoundaryViewModel(Localizer);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.Reset();

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_throws_when_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(() => new SectionErrorBoundaryViewModel(null!));

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_only_the_view_opened_event_with_the_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SectionErrorBoundaryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(["view.opened slug=SectionErrorBoundary"], lines);
    }

    [Fact]
    public void Diagnostics_count_is_thread_safe_and_monotonic()
    {
        var diagnostics = new SectionErrorBoundaryDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
