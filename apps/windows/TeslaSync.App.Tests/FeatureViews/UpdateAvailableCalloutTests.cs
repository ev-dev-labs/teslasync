using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.SystemStatus;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>UpdateAvailableCallout</c> feature surface's UI-thread-free logic — the
/// headline / body / last-checked composition, the optional-region branch selection (web truthiness on
/// <c>latest</c> / <c>current</c> / <c>checkedAt</c>), the <c>useDateFormat().formatDateTime</c> stamp, the
/// release-notes action target, the token accent + glyph metadata, the composed Narrator name, the i18n key
/// routing, the diagnostics and the registration. Mirrors the web spec
/// (web/src/features/system/components/status/UpdateAvailableCallout.tsx). The WinUI view itself
/// (feature-views\UpdateAvailableCallout\UpdateAvailableCallout.cs) is exercised by the app build.
/// </summary>
public sealed class UpdateAvailableCalloutTests
{
    private static readonly DateTimeOffset Now = new(2026, 4, 4, 12, 0, 0, TimeSpan.Zero);

    private const string ReviewSentence = "Review the release notes before upgrading your deployment.";

    private static UpdateAvailableCalloutDisplay Project(
        string? current = null,
        string? latest = null,
        DateTimeOffset? checkedAt = null,
        ILocalizer? localizer = null) =>
        UpdateAvailableCalloutProjection.Project(
            new UpdateAvailableCalloutModel(current, latest, checkedAt),
            localizer ?? PassthroughLocalizer.Instance,
            Now);

    // ── Headline (web `Update available{latest ? ` — v${latest}` : ''}`) ─────────────────────────────────

    [Fact]
    public void Title_without_latest_is_the_bare_headline()
    {
        Assert.Equal("Update available", Project().TitleText);
    }

    [Fact]
    public void Title_with_latest_appends_the_version()
    {
        Assert.Equal("Update available — v1.4.0", Project(latest: "1.4.0").TitleText);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Title_treats_a_missing_or_empty_latest_as_absent_like_web_truthiness(string? latest)
    {
        // Web `latest ? …` is falsy for undefined and the empty string.
        Assert.Equal("Update available", Project(latest: latest).TitleText);
    }

    // ── Body (web `{current ? `You're running v${current}. ` : ''}Review…`) ──────────────────────────────

    [Fact]
    public void Body_without_current_is_only_the_review_sentence()
    {
        Assert.Equal(ReviewSentence, Project().BodyText);
    }

    [Fact]
    public void Body_with_current_prepends_the_running_version()
    {
        Assert.Equal(
            "You're running v1.3.9. " + ReviewSentence,
            Project(current: "1.3.9").BodyText);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Body_treats_a_missing_or_empty_current_as_absent(string? current)
    {
        Assert.Equal(ReviewSentence, Project(current: current).BodyText);
    }

    // ── Last-checked stamp (web `{checkedAt && <span> · Last checked {formatDateTime(checkedAt)}</span>}`) ─

    [Fact]
    public void LastChecked_is_absent_when_no_timestamp_is_supplied()
    {
        var d = Project();

        Assert.False(d.HasLastChecked);
        Assert.Equal(string.Empty, d.LastCheckedText);
    }

    [Fact]
    public void LastChecked_renders_the_formatted_stamp_when_supplied()
    {
        var checkedAt = new DateTimeOffset(2026, 4, 3, 9, 30, 0, TimeSpan.Zero);
        var d = Project(checkedAt: checkedAt);

        string formatted = DateTimeFormatting.Format(checkedAt, DateTimeVariant.Full, Now);

        Assert.True(d.HasLastChecked);
        Assert.Equal("Last checked " + formatted, d.LastCheckedText);
        Assert.StartsWith("Last checked ", d.LastCheckedText, StringComparison.Ordinal);
    }

    // ── Per-state "snapshot": every region renders together, and the bare callout is never blank ─────────

    [Fact]
    public void Full_state_renders_every_region()
    {
        var checkedAt = new DateTimeOffset(2026, 4, 3, 9, 30, 0, TimeSpan.Zero);
        var d = Project(current: "1.0.0", latest: "2.0.0", checkedAt: checkedAt);

        Assert.Equal("Update available — v2.0.0", d.TitleText);
        Assert.Equal("You're running v1.0.0. " + ReviewSentence, d.BodyText);
        Assert.True(d.HasLastChecked);
        Assert.Equal(
            "Last checked " + DateTimeFormatting.Format(checkedAt, DateTimeVariant.Full, Now),
            d.LastCheckedText);
        Assert.Equal("View notes", d.ViewNotesText);
    }

    [Fact]
    public void Empty_model_still_renders_a_complete_callout_never_a_blank_box()
    {
        var d = UpdateAvailableCalloutProjection.Project(
            UpdateAvailableCalloutModel.Empty,
            PassthroughLocalizer.Instance,
            Now);

        Assert.Equal("Update available", d.TitleText);
        Assert.Equal(ReviewSentence, d.BodyText);
        Assert.False(d.HasLastChecked);
        Assert.Equal("View notes", d.ViewNotesText);
        Assert.NotEqual(string.Empty, d.AutomationName);
    }

    // ── Action (web `<a href="…/releases/latest">View notes</a>`) ────────────────────────────────────────

    [Fact]
    public void Action_targets_the_github_releases_latest_page()
    {
        Assert.Equal(
            "https://github.com/ev-dev-labs/teslasync/releases/latest",
            Project().ReleaseNotesUri.AbsoluteUri);
    }

    [Fact]
    public void Action_label_is_view_notes()
    {
        Assert.Equal("View notes", Project().ViewNotesText);
    }

    // ── Accent + glyph metadata (cyan token, Sparkles + ExternalLink marks) ──────────────────────────────

    [Fact]
    public void Accent_and_glyphs_map_to_the_token_and_segoe_fluent_marks()
    {
        var d = Project();

        Assert.Equal("TsColorInfoBrush", d.AccentBrushKey);
        Assert.Equal("\uE734", d.IconGlyph);          // Sparkle (web Sparkles)
        Assert.Equal("\uE8A7", d.ActionIconGlyph);    // OpenInNewWindow (web ExternalLink)
    }

    // ── Accessibility (the surface's composed Narrator name) ─────────────────────────────────────────────

    [Fact]
    public void AutomationName_announces_the_headline_and_body()
    {
        var d = Project(latest: "2.0.0");

        Assert.Contains(d.TitleText, d.AutomationName, StringComparison.Ordinal);
        Assert.Contains(d.BodyText, d.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void AutomationName_includes_the_last_checked_stamp_when_present()
    {
        var d = Project(checkedAt: new DateTimeOffset(2026, 4, 3, 9, 30, 0, TimeSpan.Zero));

        Assert.True(d.HasLastChecked);
        Assert.Contains(d.LastCheckedText, d.AutomationName, StringComparison.Ordinal);
    }

    // ── i18n: every region resolves through the facade (no hardcoded English in the projection) ──────────

    [Fact]
    public void Every_region_is_resolved_through_the_localizer()
    {
        var checkedAt = new DateTimeOffset(2026, 4, 3, 9, 30, 0, TimeSpan.Zero);
        var d = UpdateAvailableCalloutProjection.Project(
            new UpdateAvailableCalloutModel("1.0.0", "2.0.0", checkedAt),
            new StubLocalizer(),
            Now);

        // The stub returns sentinel values per key, so seeing them proves the projection contributes no
        // hardcoded English and threads the version + formatted time through the localized templates.
        Assert.Equal("T_TITLE_V 2.0.0", d.TitleText);
        Assert.Equal("T_CURRENT 1.0.0 T_BODY", d.BodyText);
        Assert.Equal(
            "T_CHECKED " + DateTimeFormatting.Format(checkedAt, DateTimeVariant.Full, Now),
            d.LastCheckedText);
        Assert.Equal("T_VIEW", d.ViewNotesText);
    }

    [Fact]
    public void Bare_headline_resolves_through_the_localizer()
    {
        var d = UpdateAvailableCalloutProjection.Project(
            UpdateAvailableCalloutModel.Empty,
            new StubLocalizer(),
            Now);

        Assert.Equal("T_TITLE", d.TitleText);
        Assert.Equal("T_BODY", d.BodyText);
    }

    [Fact]
    public void I18n_keys_match_the_catalog_translation_names()
    {
        Assert.Equal("translation.system.updateCallout.title", UpdateAvailableCalloutRegistration.TitleKey);
        Assert.Equal("translation.system.updateCallout.titleWithVersion", UpdateAvailableCalloutRegistration.TitleWithVersionKey);
        Assert.Equal("translation.system.updateCallout.current", UpdateAvailableCalloutRegistration.CurrentKey);
        Assert.Equal("translation.system.updateCallout.body", UpdateAvailableCalloutRegistration.BodyKey);
        Assert.Equal("translation.system.updateCallout.lastChecked", UpdateAvailableCalloutRegistration.LastCheckedKey);
        Assert.Equal("translation.system.updateCallout.viewNotes", UpdateAvailableCalloutRegistration.ViewNotesKey);
    }

    [Fact]
    public void English_fallbacks_match_the_web_source_verbatim()
    {
        // Parity: the passthrough localizer returns the English fallback, which must equal the web copy.
        var d = Project(current: "1.0.0", latest: "2.0.0");

        Assert.Equal("Update available — v2.0.0", d.TitleText);
        Assert.Equal("You're running v1.0.0. " + ReviewSentence, d.BodyText);
        Assert.Equal("View notes", d.ViewNotesText);
    }

    // ── Diagnostics (P1/S11): view.opened slug=UpdateAvailableCallout, PII-safe ──────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new UpdateAvailableCalloutDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=UpdateAvailableCallout", captured[0]);
        Assert.Equal("view.opened slug=UpdateAvailableCallout", captured[1]);
    }

    [Fact]
    public void Diagnostics_tolerates_a_null_sink()
    {
        var diagnostics = new UpdateAvailableCalloutDiagnostics();

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    // ── Registration metadata + null-argument guards ─────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_slug_accent_glyphs_and_url()
    {
        Assert.Equal("UpdateAvailableCallout", UpdateAvailableCalloutRegistration.Slug);
        Assert.Equal("TsColorInfoBrush", UpdateAvailableCalloutRegistration.AccentBrushKey);
        Assert.Equal("\uE734", UpdateAvailableCalloutRegistration.SparkleGlyph);
        Assert.Equal("\uE8A7", UpdateAvailableCalloutRegistration.ExternalLinkGlyph);
        Assert.Equal(
            "https://github.com/ev-dev-labs/teslasync/releases/latest",
            UpdateAvailableCalloutRegistration.ReleaseNotesUri.AbsoluteUri);
    }

    [Fact]
    public void Project_rejects_a_null_model()
    {
        Assert.Throws<ArgumentNullException>(() =>
            UpdateAvailableCalloutProjection.Project(null!, PassthroughLocalizer.Instance, Now));
    }

    [Fact]
    public void Project_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() =>
            UpdateAvailableCalloutProjection.Project(UpdateAvailableCalloutModel.Empty, null!, Now));
    }

    /// <summary>
    /// An <see cref="ILocalizer"/> that returns a distinct sentinel per surface key (placeholder keys keep
    /// their <c>{0}</c> so interpolation is observable) and the English fallback for anything else. Proves the
    /// projection feeds the exact catalog keys and contributes no hardcoded English.
    /// </summary>
    private sealed class StubLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key switch
        {
            UpdateAvailableCalloutRegistration.TitleKey => "T_TITLE",
            UpdateAvailableCalloutRegistration.TitleWithVersionKey => "T_TITLE_V {0}",
            UpdateAvailableCalloutRegistration.CurrentKey => "T_CURRENT {0}",
            UpdateAvailableCalloutRegistration.BodyKey => "T_BODY",
            UpdateAvailableCalloutRegistration.LastCheckedKey => "T_CHECKED {0}",
            UpdateAvailableCalloutRegistration.ViewNotesKey => "T_VIEW",
            _ => fallback,
        };
    }
}
