using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Automations;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ConflictWarnings</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / error / empty / ready), the web <c>severity === 'warning' ? …</c> parse guard, the
/// severity → variant / glyph / accent mapping, the <c>"name": reason</c> message interpolation, the
/// <c>automationId-index</c> list key, the source ordering, the i18n key resolution (passthrough fallback and
/// the resw <c>translation.*</c> catalog form), the composed per-banner and per-state Narrator names, and the
/// PII-safe diagnostics. Mirrors the web spec
/// (<c>web/src/features/automations/pages/ConflictWarnings.tsx</c>). The WinUI view itself
/// (feature-views\ConflictWarnings\ConflictWarnings.cs) is exercised by the app build.
/// </summary>
public sealed class ConflictWarningsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static AutomationConflict Conflict(
        long id = 1,
        string? name = "Morning Charge",
        string? reason = "overlaps Evening Charge",
        string? severity = "warning") =>
        new(id, name, reason, severity);

    private static ConflictWarningsDisplay Project(ConflictWarningsModel model) =>
        ConflictWarningsProjection.Project(model, Localizer);

    // ── Branch precedence: loading → empty → ready ──────────────────────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(ConflictWarningsState.Loading, Project(ConflictWarningsModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_conflicts()
    {
        var display = Project(new ConflictWarningsModel(true, new[] { Conflict() }));

        Assert.Equal(ConflictWarningsState.Loading, display.State);
        Assert.Empty(display.Banners);
    }

    [Fact]
    public void Empty_when_resolved_with_no_conflicts()
    {
        var display = Project(ConflictWarningsModel.Empty);

        Assert.Equal(ConflictWarningsState.Empty, display.State);
        Assert.Empty(display.Banners);
    }

    [Fact]
    public void Ready_when_at_least_one_conflict()
    {
        var display = Project(ConflictWarningsModel.Of(Conflict()));

        Assert.Equal(ConflictWarningsState.Ready, display.State);
        Assert.Single(display.Banners);
    }

    [Fact]
    public void Error_when_resolved_with_failure()
    {
        var display = Project(ConflictWarningsModel.Failed);

        Assert.Equal(ConflictWarningsState.Error, display.State);
        Assert.Empty(display.Banners);
    }

    [Fact]
    public void Error_takes_precedence_over_present_conflicts()
    {
        var display = Project(new ConflictWarningsModel(false, new[] { Conflict() }) { HasError = true });

        Assert.Equal(ConflictWarningsState.Error, display.State);
        Assert.Empty(display.Banners);
    }

    [Fact]
    public void Loading_takes_precedence_over_error()
    {
        var display = Project(ConflictWarningsModel.Pending with { HasError = true });

        Assert.Equal(ConflictWarningsState.Loading, display.State);
        Assert.Empty(display.Banners);
    }

    // ── Null safety ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Null_conflicts_list_collapses_to_empty()
    {
        var display = Project(new ConflictWarningsModel(false, null!));

        Assert.Equal(ConflictWarningsState.Empty, display.State);
        Assert.Empty(display.Banners);
    }

    [Fact]
    public void Null_name_and_reason_render_empty_fragments()
    {
        var display = Project(ConflictWarningsModel.Of(Conflict(name: null, reason: null)));

        Assert.Equal("\"\": ", display.Banners[0].Message);
    }

    // ── Severity parse parity (web `severity === 'warning' ? 'warning' : 'info'`) ─────────────────────────

    [Theory]
    [InlineData("warning", ConflictSeverity.Warning)]
    [InlineData("info", ConflictSeverity.Info)]
    [InlineData("Warning", ConflictSeverity.Info)] // web strict === 'warning' is case-sensitive
    [InlineData("WARNING", ConflictSeverity.Info)]
    [InlineData("danger", ConflictSeverity.Info)]
    [InlineData("", ConflictSeverity.Info)]
    public void ParseSeverity_matches_the_web_guard(string raw, ConflictSeverity expected) =>
        Assert.Equal(expected, ConflictWarningsProjection.ParseSeverity(raw));

    [Fact]
    public void ParseSeverity_treats_null_as_info() =>
        Assert.Equal(ConflictSeverity.Info, ConflictWarningsProjection.ParseSeverity(null));

    // ── Variant + glyph mapping (web variant + AlertTriangle / Info icons) ────────────────────────────────

    [Theory]
    [InlineData(ConflictSeverity.Warning, CalloutVariant.Warning)]
    [InlineData(ConflictSeverity.Info, CalloutVariant.Info)]
    public void VariantFor_maps_severity_to_callout_variant(ConflictSeverity severity, CalloutVariant expected) =>
        Assert.Equal(expected, ConflictWarningsProjection.VariantFor(severity));

    [Fact]
    public void Warning_conflict_projects_warning_variant_and_alert_triangle_glyph()
    {
        var banner = Project(ConflictWarningsModel.Of(Conflict(severity: "warning"))).Banners[0];

        Assert.Equal(ConflictSeverity.Warning, banner.Severity);
        Assert.Equal(CalloutVariant.Warning, banner.Variant);
        Assert.Equal(ConflictWarningsRegistration.AlertTriangleGlyph, banner.IconGlyph);
        Assert.Equal("TsColorWarningBrush", banner.AccentBrushKey);
    }

    [Fact]
    public void Info_conflict_projects_info_variant_and_info_glyph()
    {
        var banner = Project(ConflictWarningsModel.Of(Conflict(severity: "info"))).Banners[0];

        Assert.Equal(ConflictSeverity.Info, banner.Severity);
        Assert.Equal(CalloutVariant.Info, banner.Variant);
        Assert.Equal(ConflictWarningsRegistration.InfoGlyph, banner.IconGlyph);
        Assert.Equal("TsColorInfoBrush", banner.AccentBrushKey);
    }

    // ── Message interpolation (web `"${automation_name}": ${reason}`) ─────────────────────────────────────

    [Fact]
    public void Message_is_the_web_template_literal_verbatim()
    {
        var banner = Project(ConflictWarningsModel.Of(
            Conflict(name: "Morning Charge", reason: "overlaps Evening Charge"))).Banners[0];

        Assert.Equal("\"Morning Charge\": overlaps Evening Charge", banner.Message);
    }

    [Fact]
    public void FormatMessage_matches_the_web_template_literal() =>
        Assert.Equal("\"A\": b", ConflictWarningsProjection.FormatMessage("A", "b"));

    // ── List key (web React key `${automation_id}-${i}`) ──────────────────────────────────────────────────

    [Fact]
    public void Banner_key_is_automation_id_and_index()
    {
        var display = Project(new ConflictWarningsModel(false, new[]
        {
            Conflict(id: 42),
            Conflict(id: 42),
            Conflict(id: 7),
        }));

        Assert.Equal("42-0", display.Banners[0].Key);
        Assert.Equal("42-1", display.Banners[1].Key);
        Assert.Equal("7-2", display.Banners[2].Key);
    }

    // ── Ordering: banners follow the source `conflicts` order ─────────────────────────────────────────────

    [Fact]
    public void Banners_preserve_source_order()
    {
        var display = Project(new ConflictWarningsModel(false, new[]
        {
            Conflict(name: "First", reason: "r1"),
            Conflict(name: "Second", reason: "r2"),
        }));

        Assert.Equal(2, display.Banners.Count);
        Assert.Equal("\"First\": r1", display.Banners[0].Message);
        Assert.Equal("\"Second\": r2", display.Banners[1].Message);
    }

    [Fact]
    public void Mixed_severities_are_each_projected_independently()
    {
        var display = Project(new ConflictWarningsModel(false, new[]
        {
            Conflict(severity: "warning"),
            Conflict(severity: "info"),
        }));

        Assert.Equal(CalloutVariant.Warning, display.Banners[0].Variant);
        Assert.Equal(CalloutVariant.Info, display.Banners[1].Variant);
    }

    // ── i18n: the shared heading + empty / loading copy ──────────────────────────────────────────────────

    [Fact]
    public void Banner_title_uses_the_shared_conflict_string()
    {
        var banner = Project(ConflictWarningsModel.Of(Conflict())).Banners[0];

        Assert.Equal("Potential Conflict", banner.Title);
    }

    [Fact]
    public void Empty_message_uses_the_shared_common_no_data_string() =>
        Assert.Equal("No data available", Project(ConflictWarningsModel.Empty).EmptyMessage);

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(ConflictWarningsModel.Pending).LoadingLabel);

    [Fact]
    public void Error_title_uses_the_shared_network_error_string() =>
        Assert.Equal("Can't reach server", Project(ConflictWarningsModel.Failed).ErrorTitle);

    [Fact]
    public void Error_message_uses_the_shared_network_error_string() =>
        Assert.Equal(
            "Check your internet connection and try again.",
            Project(ConflictWarningsModel.Failed).ErrorMessage);

    [Fact]
    public void Error_retry_label_uses_the_shared_retry_string() =>
        Assert.Equal("Retry", Project(ConflictWarningsModel.Failed).RetryLabel);

    [Fact]
    public void I18n_keys_use_the_resw_translation_catalog_form()
    {
        Assert.Equal("translation.automations.builder.conflict", ConflictWarningsProjection.ConflictTitleKey);
        Assert.Equal("translation.common.noData", ConflictWarningsProjection.EmptyMessageKey);
        Assert.Equal("translation.common.loading", ConflictWarningsProjection.LoadingKey);
        Assert.Equal("translation.error.network.title", ConflictWarningsProjection.ErrorTitleKey);
        Assert.Equal("translation.error.network.message", ConflictWarningsProjection.ErrorMessageKey);
        Assert.Equal("translation.error.retry", ConflictWarningsProjection.RetryKey);
    }

    // ── Accessibility: every state and every banner exposes a meaningful Narrator name ────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(ConflictWarningsModel.Pending),
                Project(ConflictWarningsModel.Failed),
                Project(ConflictWarningsModel.Empty),
                Project(ConflictWarningsModel.Of(Conflict())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading", Project(ConflictWarningsModel.Pending).AutomationName);

    [Fact]
    public void Error_automation_name_is_the_error_title() =>
        Assert.Equal("Can't reach server", Project(ConflictWarningsModel.Failed).AutomationName);

    [Fact]
    public void Empty_automation_name_is_the_empty_message() =>
        Assert.Equal("No data available", Project(ConflictWarningsModel.Empty).AutomationName);

    [Fact]
    public void Ready_automation_name_is_the_shared_conflict_heading() =>
        Assert.Equal("Potential Conflict", Project(ConflictWarningsModel.Of(Conflict())).AutomationName);

    [Fact]
    public void Banner_automation_name_carries_the_title_and_message()
    {
        var banner = Project(ConflictWarningsModel.Of(
            Conflict(name: "Morning Charge", reason: "overlaps Evening Charge"))).Banners[0];

        Assert.Equal("Potential Conflict. \"Morning Charge\": overlaps Evening Charge", banner.AutomationName);
    }

    // ── Diagnostics (P1/S11): view.opened slug=ConflictWarnings, PII-safe ────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ConflictWarningsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ConflictWarnings", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_conflict_content()
    {
        var captured = new List<string>();
        var diagnostics = new ConflictWarningsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=ConflictWarnings", line);
        Assert.DoesNotContain("Morning", line, StringComparison.Ordinal);
        Assert.DoesNotContain("overlaps", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("ConflictWarnings", ConflictWarningsRegistration.Slug);

    [Fact]
    public void Registration_exposes_distinct_severity_glyphs() =>
        Assert.NotEqual(ConflictWarningsRegistration.AlertTriangleGlyph, ConflictWarningsRegistration.InfoGlyph);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => ConflictWarningsProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => ConflictWarningsProjection.Project(ConflictWarningsModel.Pending, null!));
}
