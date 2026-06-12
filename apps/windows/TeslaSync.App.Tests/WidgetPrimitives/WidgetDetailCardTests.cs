using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.WidgetPrimitives.WidgetDetailCardSurface;
using Xunit;

namespace TeslaSync.App.Tests.WidgetPrimitives;

/// <summary>
/// Headless verification of the <c>WidgetDetailCard</c> widget primitive's UI-thread-free logic — the empty
/// branch (the always-rendered friendly surface with its localized / overridable message and optional glyph),
/// the populated branch (rows, value <c>?? '—'</c> fallback, monospace flag, badge-variant → status mapping,
/// the per-row bottom-hairline guard), the compact slice (the web <c>entries.slice(0, 4)</c>), the composed
/// accessible names, the registration metadata and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (<c>web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx</c>). The WinUI view itself
/// (WidgetDetailCard.cs) is exercised by the app build.
/// </summary>
public sealed class WidgetDetailCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static WidgetDetailCardDisplay Project(WidgetDetailCardModel model) =>
        WidgetDetailCardProjection.Project(model, Localizer);

    private static WidgetDetailCardModel Populated(int count, bool compact = false)
    {
        var entries = new List<WidgetDetailEntry>(count);
        for (int i = 0; i < count; i++)
        {
            entries.Add(WidgetDetailEntry.Text($"Label {i}", $"Value {i}"));
        }

        return WidgetDetailCardModel.Create(entries, compact);
    }

    // ── registration (diagnostics slug) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("WidgetDetailCard", WidgetDetailCardRegistration.Slug);

    // ── empty branch (web entries.length === 0 → EmptyState) — always renders ────────────────────────────

    [Fact]
    public void No_entries_renders_the_empty_surface_with_the_localized_default()
    {
        WidgetDetailCardDisplay d = Project(WidgetDetailCardModel.Empty);

        Assert.True(d.IsEmpty);
        Assert.Empty(d.Rows);
        // Web default literal `'No details available'`, resolved through the i18n facade (fallback path).
        Assert.Equal("No details available", d.EmptyMessage);
        Assert.Null(d.EmptyIconGlyph);
    }

    [Fact]
    public void Empty_message_override_replaces_the_default()
    {
        WidgetDetailCardModel model = WidgetDetailCardModel.Create(
            Array.Empty<WidgetDetailEntry>(),
            emptyMessage: "No charging sessions yet");

        Assert.Equal("No charging sessions yet", Project(model).EmptyMessage);
    }

    [Fact]
    public void Empty_icon_glyph_is_passed_through()
    {
        WidgetDetailCardModel model = WidgetDetailCardModel.Create(
            Array.Empty<WidgetDetailEntry>(),
            emptyIconGlyph: "\uE7C3");

        Assert.Equal("\uE7C3", Project(model).EmptyIconGlyph);
    }

    // ── populated branch (web mapped rows) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Entries_render_one_row_each_in_order()
    {
        WidgetDetailCardDisplay d = Project(Populated(3));

        Assert.False(d.IsEmpty);
        Assert.Equal(3, d.Rows.Count);
        Assert.Equal("Label 0", d.Rows[0].Label);
        Assert.Equal("Value 0", d.Rows[0].DisplayValue);
        Assert.Equal(string.Empty, d.EmptyMessage);
        Assert.Null(d.EmptyIconGlyph);
    }

    [Fact]
    public void Null_value_renders_the_muted_em_dash()
    {
        var model = WidgetDetailCardModel.Create(new[] { WidgetDetailEntry.Text("Range", null) });

        Assert.Equal("\u2014", Project(model).Rows[0].DisplayValue);
    }

    [Theory]
    [InlineData(42.5, "42.5")]
    [InlineData(0, "0")]
    [InlineData(-3, "-3")]
    public void Number_value_renders_with_the_invariant_culture(double value, string expected)
    {
        var model = WidgetDetailCardModel.Create(new[] { WidgetDetailEntry.Number("Power", value) });

        Assert.Equal(expected, Project(model).Rows[0].DisplayValue);
    }

    [Fact]
    public void Null_number_value_renders_the_muted_em_dash()
    {
        var model = WidgetDetailCardModel.Create(new[] { WidgetDetailEntry.Number("Power", null) });

        Assert.Equal("\u2014", Project(model).Rows[0].DisplayValue);
    }

    [Fact]
    public void Mono_flag_flows_to_the_row()
    {
        var model = WidgetDetailCardModel.Create(new[]
        {
            WidgetDetailEntry.Text("VIN", "5YJ3E1EA7KF", mono: true),
            WidgetDetailEntry.Text("Name", "Model 3"),
        });

        WidgetDetailCardDisplay d = Project(model);

        Assert.True(d.Rows[0].Mono);
        Assert.False(d.Rows[1].Mono);
    }

    // ── badge resolution (web entry.badge + badgeVariantMap) ─────────────────────────────────────────────

    [Fact]
    public void Row_without_a_badge_reports_no_badge()
    {
        WidgetDetailRowDisplay row = Project(Populated(1)).Rows[0];

        Assert.False(row.HasBadge);
        Assert.Equal(string.Empty, row.BadgeText);
        Assert.Equal(StatusKind.Neutral, row.BadgeStatus);
    }

    [Fact]
    public void Row_with_a_badge_resolves_text_and_status()
    {
        var model = WidgetDetailCardModel.Create(new[]
        {
            WidgetDetailEntry.Text("Charge", "Complete", new WidgetDetailBadge("OK", WidgetDetailBadgeVariant.Success)),
        });

        WidgetDetailRowDisplay row = Project(model).Rows[0];

        Assert.True(row.HasBadge);
        Assert.Equal("OK", row.BadgeText);
        Assert.Equal(StatusKind.Success, row.BadgeStatus);
    }

    [Theory]
    [InlineData(WidgetDetailBadgeVariant.Success, StatusKind.Success)]
    [InlineData(WidgetDetailBadgeVariant.Warning, StatusKind.Warning)]
    [InlineData(WidgetDetailBadgeVariant.Error, StatusKind.Danger)]
    [InlineData(WidgetDetailBadgeVariant.Neutral, StatusKind.Neutral)]
    public void Badge_variant_maps_to_the_web_status(WidgetDetailBadgeVariant variant, StatusKind expected) =>
        Assert.Equal(expected, WidgetDetailCardProjection.StatusFor(variant));

    // ── divider guard (web i < visible.length - 1) ───────────────────────────────────────────────────────

    [Fact]
    public void Every_row_but_the_last_shows_a_divider()
    {
        WidgetDetailCardDisplay d = Project(Populated(3));

        Assert.True(d.Rows[0].ShowDivider);
        Assert.True(d.Rows[1].ShowDivider);
        Assert.False(d.Rows[2].ShowDivider);
    }

    [Fact]
    public void A_single_row_shows_no_divider() =>
        Assert.False(Project(Populated(1)).Rows[0].ShowDivider);

    // ── compact slice (web compact ? entries.slice(0, 4) : entries) ──────────────────────────────────────

    [Fact]
    public void Compact_shows_only_the_first_four_rows()
    {
        WidgetDetailCardDisplay d = Project(Populated(6, compact: true));

        Assert.Equal(4, d.Rows.Count);
        Assert.Equal("Label 0", d.Rows[0].Label);
        Assert.Equal("Label 3", d.Rows[3].Label);
        // The hairline guard is recomputed against the sliced set: the fourth visible row is now the last.
        Assert.False(d.Rows[3].ShowDivider);
    }

    [Fact]
    public void Compact_with_four_or_fewer_shows_all_rows()
    {
        Assert.Equal(4, Project(Populated(4, compact: true)).Rows.Count);
        Assert.Equal(2, Project(Populated(2, compact: true)).Rows.Count);
    }

    [Fact]
    public void Non_compact_shows_all_rows() =>
        Assert.Equal(6, Project(Populated(6)).Rows.Count);

    // ── accessibility: composed names from the original (non-uppercased) label ───────────────────────────

    [Fact]
    public void Row_automation_name_pairs_label_and_value()
    {
        var model = WidgetDetailCardModel.Create(new[] { WidgetDetailEntry.Text("Battery", "82%") });

        WidgetDetailRowDisplay row = Project(model).Rows[0];

        Assert.Equal("Battery", row.Label);
        Assert.Equal("Battery: 82%", row.AutomationName);
    }

    [Fact]
    public void Row_automation_name_appends_the_badge_text()
    {
        var model = WidgetDetailCardModel.Create(new[]
        {
            WidgetDetailEntry.Text("Charge", "Complete", new WidgetDetailBadge("OK", WidgetDetailBadgeVariant.Success)),
        });

        Assert.Equal("Charge: Complete, OK", Project(model).Rows[0].AutomationName);
    }

    [Fact]
    public void Row_automation_name_describes_a_missing_value()
    {
        var model = WidgetDetailCardModel.Create(new[] { WidgetDetailEntry.Text("Range", null) });

        Assert.Equal("Range: \u2014", Project(model).Rows[0].AutomationName);
    }

    [Fact]
    public void Row_automation_name_is_non_empty_in_every_branch()
    {
        foreach (WidgetDetailRowDisplay row in Project(Populated(3)).Rows)
        {
            Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        }
    }

    // ── diagnostics (view.opened, PII-safe — never the labels or values) ─────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new WidgetDetailCardDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WidgetDetailCard", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new WidgetDetailCardDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<System.ArgumentNullException>(() => WidgetDetailCardProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => WidgetDetailCardProjection.Project(WidgetDetailCardModel.Empty, null!));

    [Fact]
    public void Create_rejects_a_null_entry_list() =>
        Assert.Throws<System.ArgumentNullException>(() => WidgetDetailCardModel.Create(null!));
}
