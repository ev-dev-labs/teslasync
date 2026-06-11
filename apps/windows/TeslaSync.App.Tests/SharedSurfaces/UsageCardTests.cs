using System;
using System.Collections.Generic;
using TeslaSync.App.SharedSurfaces.UsageCardSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>UsageCard</c> shared surface's UI-thread-free logic — the pure projection
/// (the empty-vs-populated decision, each optional region's show flag, the budget bar math, the intent → token
/// palette and the accessible-name fallback), the data seam's change notifications, the view-model's state
/// projection, the PII-safe diagnostics and the registration metadata. The composition cases mirror the web
/// source (web/src/components/data-display/UsageCard.tsx). The WinUI view itself (the section layout, the
/// reflow grids, the progress-bar peer, the footer hyperlinks, the empty state) is exercised by the app build.
/// </summary>
public sealed class UsageCardTests
{
    private static UsageCardBudget Budget(
        double pct = 40,
        UsageCardIntent intent = UsageCardIntent.Normal,
        string headline = "$0.42 of $5.00",
        string? rightLabel = "8% of monthly credit",
        string? caption = "Day 5 of 30",
        string ariaLabel = "Monthly API budget") =>
        new()
        {
            Headline = headline,
            RightLabel = rightLabel,
            Caption = caption,
            Pct = pct,
            Intent = intent,
            AriaLabel = ariaLabel,
        };

    private static UsageCardBand Band(string label = "This month", string value = "1,234", UsageCardIntent intent = UsageCardIntent.Normal) =>
        new() { Label = label, Value = value, Intent = intent, Sub = "≈ 41 / day" };

    private static UsageCardDetail Detail(string label = "Error rate", string value = "0.3%", UsageCardIntent intent = UsageCardIntent.Normal) =>
        new() { Label = label, Value = value, Intent = intent };

    private static UsageCardTopList TopList(string key = "services", string title = "Top services") =>
        new()
        {
            Key = key,
            Title = title,
            Items = new[] { new UsageCardTopListItem { Key = "vehicle", Label = "/vehicles", Value = "812" } },
        };

    private static UsageCardBanner Banner(string title = "Over monthly credit") =>
        new() { Title = title, Description = "Spending exceeds the configured cap." };

    private static UsageCardFooterLink Footer(string key = "logs", string label = "API logs", bool primary = false, bool external = false) =>
        new() { Key = key, Route = "/system/api-logs", Label = label, Primary = primary, External = external };

    private static UsageCardDisplay Project(UsageCardInput input) => UsageCardProjection.Project(input);

    // ── Empty state (web hasAnything, L183-L197) ─────────────────────────────────────────────────────────

    [Fact]
    public void No_regions_resolves_to_the_empty_state()
    {
        var d = Project(new UsageCardInput { EmptyMessage = "No usage yet" });

        Assert.True(d.ShowEmptyState);
        Assert.False(d.HasAnything);
        Assert.Equal("No usage yet", d.EmptyMessage);
        Assert.False(d.ShowBudget);
        Assert.False(d.ShowBands);
        Assert.False(d.ShowDetails);
        Assert.False(d.ShowTopLists);
        Assert.False(d.ShowBanner);
        Assert.False(d.ShowFooter);
    }

    [Fact]
    public void Empty_message_is_not_defaulted_to_english()
    {
        var d = Project(new UsageCardInput());

        Assert.True(d.ShowEmptyState);
        Assert.Equal(string.Empty, d.EmptyMessage);
    }

    [Fact]
    public void Budget_alone_is_not_empty()
    {
        var d = Project(new UsageCardInput { Budget = Budget() });

        Assert.False(d.ShowEmptyState);
        Assert.True(d.ShowBudget);
    }

    [Fact]
    public void Bands_alone_are_not_empty()
    {
        var d = Project(new UsageCardInput { Bands = new[] { Band() } });

        Assert.False(d.ShowEmptyState);
        Assert.True(d.ShowBands);
    }

    [Fact]
    public void Details_alone_are_not_empty()
    {
        var d = Project(new UsageCardInput { Details = new[] { Detail() } });

        Assert.False(d.ShowEmptyState);
        Assert.True(d.ShowDetails);
    }

    [Fact]
    public void TopLists_alone_are_not_empty()
    {
        var d = Project(new UsageCardInput { TopLists = new[] { TopList() } });

        Assert.False(d.ShowEmptyState);
        Assert.True(d.ShowTopLists);
    }

    [Fact]
    public void Banner_alone_is_not_empty()
    {
        var d = Project(new UsageCardInput { Banner = Banner() });

        Assert.False(d.ShowEmptyState);
        Assert.True(d.ShowBanner);
    }

    [Fact]
    public void Footer_alone_is_not_empty()
    {
        var d = Project(new UsageCardInput { Footer = new[] { Footer() } });

        Assert.False(d.ShowEmptyState);
        Assert.True(d.ShowFooter);
    }

    [Fact]
    public void Empty_collections_are_treated_as_absent()
    {
        var d = Project(new UsageCardInput
        {
            Bands = Array.Empty<UsageCardBand>(),
            Details = Array.Empty<UsageCardDetail>(),
            TopLists = Array.Empty<UsageCardTopList>(),
            Footer = Array.Empty<UsageCardFooterLink>(),
        });

        Assert.True(d.ShowEmptyState);
    }

    // ── Collection normalization (web null-safe map) ─────────────────────────────────────────────────────

    [Fact]
    public void Null_collections_normalise_to_empty_lists()
    {
        var d = Project(new UsageCardInput());

        Assert.NotNull(d.Bands);
        Assert.NotNull(d.Details);
        Assert.NotNull(d.TopLists);
        Assert.NotNull(d.Footer);
        Assert.Empty(d.Bands);
        Assert.Empty(d.Details);
        Assert.Empty(d.TopLists);
        Assert.Empty(d.Footer);
    }

    [Fact]
    public void Populated_collections_round_trip()
    {
        var d = Project(new UsageCardInput
        {
            Bands = new[] { Band(), Band("Last 24h", "57") },
            Details = new[] { Detail() },
            TopLists = new[] { TopList(), TopList("methods", "By method") },
            Footer = new[] { Footer(), Footer("account", "Tesla account", external: true) },
        });

        Assert.Equal(2, d.Bands.Count);
        Assert.Single(d.Details);
        Assert.Equal(2, d.TopLists.Count);
        Assert.Equal(2, d.Footer.Count);
    }

    // ── Budget projection (web BudgetSection L220-L262) ──────────────────────────────────────────────────

    [Fact]
    public void Budget_clamps_the_bar_but_announces_the_unclamped_percentage()
    {
        var d = Project(new UsageCardInput { Budget = Budget(pct: 120, intent: UsageCardIntent.Danger) });

        Assert.NotNull(d.Budget);
        Assert.Equal(100, d.Budget!.BarValue);
        Assert.Equal(120, d.Budget.AnnouncedPercent);
    }

    [Fact]
    public void Budget_clamps_negative_to_zero()
    {
        var d = Project(new UsageCardInput { Budget = Budget(pct: -5) });

        Assert.Equal(0, d.Budget!.BarValue);
        Assert.Equal(0, d.Budget.AnnouncedPercent);
    }

    [Theory]
    [InlineData(8.5, 9)]
    [InlineData(8.4, 8)]
    [InlineData(0, 0)]
    [InlineData(99.6, 100)]
    public void Budget_announced_percentage_rounds_away_from_zero(double pct, int expected)
    {
        var d = Project(new UsageCardInput { Budget = Budget(pct: pct) });

        Assert.Equal(expected, d.Budget!.AnnouncedPercent);
    }

    [Fact]
    public void Budget_tolerates_nan_percentage()
    {
        var d = Project(new UsageCardInput { Budget = Budget(pct: double.NaN) });

        Assert.Equal(0, d.Budget!.BarValue);
        Assert.Equal(0, d.Budget.AnnouncedPercent);
    }

    [Theory]
    [InlineData(UsageCardIntent.Normal, "TsColorAccentBrush")]
    [InlineData(UsageCardIntent.Warn, "TsColorWarningBrush")]
    [InlineData(UsageCardIntent.Danger, "TsColorDangerBrush")]
    public void Budget_accent_key_follows_intent(UsageCardIntent intent, string expectedKey)
    {
        var d = Project(new UsageCardInput { Budget = Budget(intent: intent) });

        Assert.Equal(expectedKey, d.Budget!.AccentBrushKey);
    }

    [Fact]
    public void Budget_right_label_shown_only_when_present_and_danger_flag_tracks_intent()
    {
        Assert.True(Project(new UsageCardInput { Budget = Budget(rightLabel: "8%") }).Budget!.ShowRightLabel);
        Assert.False(Project(new UsageCardInput { Budget = Budget(rightLabel: null) }).Budget!.ShowRightLabel);
        Assert.False(Project(new UsageCardInput { Budget = Budget(rightLabel: "") }).Budget!.ShowRightLabel);

        Assert.True(Project(new UsageCardInput { Budget = Budget(rightLabel: "x", intent: UsageCardIntent.Danger) }).Budget!.RightLabelIsDanger);
        Assert.False(Project(new UsageCardInput { Budget = Budget(rightLabel: "x", intent: UsageCardIntent.Warn) }).Budget!.RightLabelIsDanger);
    }

    [Fact]
    public void Budget_caption_shown_only_when_present()
    {
        Assert.True(Project(new UsageCardInput { Budget = Budget(caption: "Day 5") }).Budget!.ShowCaption);
        Assert.False(Project(new UsageCardInput { Budget = Budget(caption: null) }).Budget!.ShowCaption);
        Assert.False(Project(new UsageCardInput { Budget = Budget(caption: "") }).Budget!.ShowCaption);
    }

    [Fact]
    public void Budget_accessible_name_prefers_aria_label_then_headline()
    {
        Assert.Equal("Monthly API budget", Project(new UsageCardInput { Budget = Budget(ariaLabel: "Monthly API budget") }).Budget!.AccessibleName);
        Assert.Equal("$0.42 of $5.00", Project(new UsageCardInput { Budget = Budget(ariaLabel: "") }).Budget!.AccessibleName);
    }

    // ── Accessible name fallback chain (the card region is never anonymous) ──────────────────────────────

    [Fact]
    public void Card_accessible_name_prefers_budget_aria_label()
    {
        var d = Project(new UsageCardInput
        {
            Budget = Budget(ariaLabel: "Monthly API budget"),
            Banner = Banner("Over credit"),
        });

        Assert.Equal("Monthly API budget", d.AccessibleName);
    }

    [Fact]
    public void Card_accessible_name_falls_back_through_the_regions()
    {
        Assert.Equal("Over credit", Project(new UsageCardInput { Banner = Banner("Over credit") }).AccessibleName);
        Assert.Equal("This month", Project(new UsageCardInput { Bands = new[] { Band("This month", "1,234") } }).AccessibleName);
        Assert.Equal("Error rate", Project(new UsageCardInput { Details = new[] { Detail("Error rate", "0.3%") } }).AccessibleName);
        Assert.Equal("Top services", Project(new UsageCardInput { TopLists = new[] { TopList("services", "Top services") } }).AccessibleName);
        Assert.Equal("API logs", Project(new UsageCardInput { Footer = new[] { Footer("logs", "API logs") } }).AccessibleName);
    }

    [Fact]
    public void Every_populated_composition_exposes_a_non_empty_accessible_name()
    {
        foreach (var input in new[]
                 {
                     new UsageCardInput { Budget = Budget() },
                     new UsageCardInput { Bands = new[] { Band() } },
                     new UsageCardInput { Details = new[] { Detail() } },
                     new UsageCardInput { TopLists = new[] { TopList() } },
                     new UsageCardInput { Banner = Banner() },
                     new UsageCardInput { Footer = new[] { Footer() } },
                 })
        {
            Assert.False(string.IsNullOrWhiteSpace(Project(input).AccessibleName));
        }
    }

    // ── Full composition (every region on at once) ───────────────────────────────────────────────────────

    [Fact]
    public void Full_composition_shows_every_region()
    {
        var d = Project(new UsageCardInput
        {
            Budget = Budget(),
            Bands = new[] { Band(), Band("Last 24h", "57"), Band("Forecast", "$3.10") },
            Details = new[] { Detail(), Detail("Skipped", "12") },
            TopLists = new[] { TopList(), TopList("methods", "By method") },
            Banner = Banner(),
            Footer = new[] { Footer(primary: true), Footer("account", "Tesla account", external: true) },
        });

        Assert.False(d.ShowEmptyState);
        Assert.True(d.ShowBudget);
        Assert.True(d.ShowBands);
        Assert.True(d.ShowDetails);
        Assert.True(d.ShowTopLists);
        Assert.True(d.ShowBanner);
        Assert.True(d.ShowFooter);
    }

    // ── Projection argument validation + null safety ─────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_input() =>
        Assert.Throws<ArgumentNullException>(() => UsageCardProjection.Project(null!));

    // ── Intent → token palette ───────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(UsageCardIntent.Normal, "TsColorAccentBrush")]
    [InlineData(UsageCardIntent.Warn, "TsColorWarningBrush")]
    [InlineData(UsageCardIntent.Danger, "TsColorDangerBrush")]
    public void Palette_budget_bar_brush_key(UsageCardIntent intent, string expected) =>
        Assert.Equal(expected, UsageCardPalette.BudgetBarBrushKey(intent));

    [Theory]
    [InlineData(UsageCardIntent.Normal, "TsColorTextPrimaryBrush")]
    [InlineData(UsageCardIntent.Warn, "TsColorWarningBrush")]
    [InlineData(UsageCardIntent.Danger, "TsColorDangerBrush")]
    public void Palette_value_brush_key(UsageCardIntent intent, string expected) =>
        Assert.Equal(expected, UsageCardPalette.ValueBrushKey(intent));

    [Fact]
    public void Palette_band_tint_color_key_is_null_for_normal_and_set_for_warn_and_danger()
    {
        Assert.Null(UsageCardPalette.BandTintColorKey(UsageCardIntent.Normal));
        Assert.Equal("TsColorWarningColor", UsageCardPalette.BandTintColorKey(UsageCardIntent.Warn));
        Assert.Equal("TsColorDangerColor", UsageCardPalette.BandTintColorKey(UsageCardIntent.Danger));
    }

    // ── Data seam: change notifications (P1/S8) ──────────────────────────────────────────────────────────

    [Fact]
    public void Source_starts_with_a_default_empty_input()
    {
        var source = new UsageCardSource();

        Assert.Null(source.Input.Budget);
        Assert.Null(source.Input.Bands);
        Assert.Null(source.Input.Banner);
    }

    [Fact]
    public void Source_set_input_replaces_and_notifies()
    {
        var source = new UsageCardSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetInput(new UsageCardInput { Budget = Budget() });

        Assert.Equal(1, changes);
        Assert.NotNull(source.Input.Budget);
    }

    [Fact]
    public void Source_set_input_null_falls_back_to_default()
    {
        var source = new UsageCardSource(new UsageCardInput { Budget = Budget() });

        source.SetInput(null!);

        Assert.Null(source.Input.Budget);
    }

    [Fact]
    public void Source_focused_mutators_update_one_region_and_notify()
    {
        var source = new UsageCardSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetBudget(Budget());
        source.SetBands(new[] { Band() });
        source.SetDetails(new[] { Detail() });
        source.SetTopLists(new[] { TopList() });
        source.SetBanner(Banner());
        source.SetFooter(new[] { Footer() });
        source.SetEmptyMessage("No usage yet");

        Assert.Equal(7, changes);
        Assert.NotNull(source.Input.Budget);
        Assert.Single(source.Input.Bands!);
        Assert.Single(source.Input.Details!);
        Assert.Single(source.Input.TopLists!);
        Assert.NotNull(source.Input.Banner);
        Assert.Single(source.Input.Footer!);
        Assert.Equal("No usage yet", source.Input.EmptyMessage);
    }

    [Fact]
    public void Source_set_budget_null_drops_only_the_budget()
    {
        var source = new UsageCardSource(new UsageCardInput { Budget = Budget(), Bands = new[] { Band() } });

        source.SetBudget(null);

        Assert.Null(source.Input.Budget);
        Assert.Single(source.Input.Bands!);
    }

    // ── View-model: projection over the seam ─────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_projects_the_initial_source_frame()
    {
        var source = new UsageCardSource(new UsageCardInput { Budget = Budget(intent: UsageCardIntent.Warn) });
        using var vm = new UsageCardViewModel(source);

        Assert.True(vm.Display.ShowBudget);
        Assert.False(vm.ShowEmptyState);
        Assert.Equal("TsColorWarningBrush", vm.Display.Budget!.AccentBrushKey);
    }

    [Fact]
    public void ViewModel_reprojects_and_notifies_when_the_input_changes()
    {
        var source = new UsageCardSource();
        using var vm = new UsageCardViewModel(source);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        Assert.True(vm.ShowEmptyState);

        source.SetBands(new[] { Band() });

        Assert.False(vm.ShowEmptyState);
        Assert.True(vm.Display.ShowBands);
        Assert.Contains(nameof(UsageCardViewModel.Display), changed);
        Assert.Contains(nameof(UsageCardViewModel.ShowEmptyState), changed);
    }

    [Fact]
    public void Disposed_view_model_stops_reprojecting()
    {
        var source = new UsageCardSource(new UsageCardInput { Bands = new[] { Band() } });
        var vm = new UsageCardViewModel(source);

        vm.Dispose();
        source.SetBands(null);

        Assert.True(vm.Display.ShowBands);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new UsageCardViewModel(new UsageCardSource());

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    [Fact]
    public void ViewModel_rejects_a_null_source() =>
        Assert.Throws<ArgumentNullException>(() => new UsageCardViewModel(null!));

    // ── Diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_and_emits_the_slug()
    {
        var events = new List<string>();
        var diagnostics = new UsageCardDiagnostics(events.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(2, events.Count);
        Assert.All(events, e => Assert.Equal("view.opened slug=UsageCard", e));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_counts()
    {
        var diagnostics = new UsageCardDiagnostics();

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    // ── Registration metadata ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_canonical_slug_and_bar_max()
    {
        Assert.Equal("UsageCard", UsageCardRegistration.Slug);
        Assert.Equal("UsageCard", UsageCardViewModel.Slug);
        Assert.Equal(100, UsageCardRegistration.BudgetBarMax);
    }
}
