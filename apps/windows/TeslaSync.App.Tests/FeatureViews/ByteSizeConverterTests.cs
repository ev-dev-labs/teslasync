using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ByteSizeConverter feature-view's UI-thread-free logic — the ECMAScript
/// <c>parseFloat</c> port, the pure conversion projection (the web <c>useMemo</c> data adapter), the
/// state-holder view-model's empty ↔ populated transitions plus its localized labels / Narrator summary,
/// the byte-unit ladder, and the registry/diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/devtools/tools/ByteSizeConverter.tsx).
/// </summary>
public sealed class ByteSizeConverterTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ---- JsNumber.ParseFloat (web parseFloat parity) --------------------------------

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("abc")]
    [InlineData("-")]
    [InlineData("+")]
    [InlineData("e5")]
    [InlineData(".")]
    public void ParseFloat_returns_NaN_for_non_numbers(string input)
    {
        Assert.True(double.IsNaN(JsNumber.ParseFloat(input)));
    }

    [Theory]
    [InlineData("1024", 1024)]
    [InlineData("  12  ", 12)]        // leading whitespace skipped, trailing ignored
    [InlineData("12abc", 12)]         // longest numeric prefix
    [InlineData("1,024", 1)]          // stops at the comma (a parseFloat quirk)
    [InlineData("3.14", 3.14)]
    [InlineData(".5", 0.5)]
    [InlineData("1e3", 1000)]
    [InlineData("1.2.3", 1.2)]        // stops at the second dot
    [InlineData("-5", -5)]
    [InlineData("+7", 7)]
    [InlineData("1e", 1)]             // a bare exponent marker is dropped
    public void ParseFloat_matches_javascript(string input, double expected)
    {
        Assert.Equal(expected, JsNumber.ParseFloat(input), 10);
    }

    [Fact]
    public void ParseFloat_reads_infinity()
    {
        Assert.True(double.IsPositiveInfinity(JsNumber.ParseFloat("Infinity")));
        Assert.True(double.IsNegativeInfinity(JsNumber.ParseFloat("-Infinity")));
    }

    // ---- Byte units (web BYTE_UNITS) ------------------------------------------------

    [Fact]
    public void Units_match_the_web_constant()
    {
        Assert.Equal(new[] { "B", "KB", "MB", "GB", "TB" }, ByteSizeUnits.All);
        Assert.Equal("B", ByteSizeUnits.Default);
    }

    [Theory]
    [InlineData("B", 0)]
    [InlineData("KB", 1)]
    [InlineData("TB", 4)]
    [InlineData("X", -1)]
    [InlineData(null, -1)]
    public void Units_index_of(string? unit, int expected)
    {
        Assert.Equal(expected, ByteSizeUnits.IndexOf(unit));
    }

    // ---- Projection: the empty branch (web conversions === null) --------------------

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("abc")]
    public void Project_returns_null_for_invalid_value(string value)
    {
        Assert.Null(ByteSizeProjection.Project(value, "B"));
    }

    [Fact]
    public void Project_returns_null_for_unknown_unit()
    {
        Assert.Null(ByteSizeProjection.Project("1024", "PB"));
    }

    // ---- Projection: the populated branch (web fmtNumber ladder) ---------------------

    [Fact]
    public void Project_converts_bytes_with_web_precision()
    {
        var conversions = ByteSizeProjection.Project("1024", "B");

        Assert.NotNull(conversions);
        Assert.Equal(5, conversions!.Count);
        // Bytes formatted at 0 fraction digits (web i === 0), every larger unit at 4.
        Assert.Equal(new[] { "1,024", "1.0000", "0.0010", "0.0000", "0.0000" }, Values(conversions));
        Assert.Equal(new[] { "B", "KB", "MB", "GB", "TB" }, Symbols(conversions));
    }

    [Fact]
    public void Project_promotes_from_the_chosen_unit()
    {
        // 1 KB must read 1,024 in the B cell and 1.0000 in the KB cell.
        var conversions = ByteSizeProjection.Project("1", "KB");

        Assert.NotNull(conversions);
        Assert.Equal("1,024", conversions![0].Value);
        Assert.Equal("1.0000", conversions[1].Value);
    }

    [Fact]
    public void Project_marks_only_the_chosen_unit_active()
    {
        var conversions = ByteSizeProjection.Project("5", "MB");

        Assert.NotNull(conversions);
        Assert.Collection(
            conversions!,
            c => Assert.False(c.IsActive),
            c => Assert.False(c.IsActive),
            c => Assert.True(c.IsActive),   // MB
            c => Assert.False(c.IsActive),
            c => Assert.False(c.IsActive));
    }

    [Fact]
    public void Project_uses_parsed_prefix_like_the_web()
    {
        // parseFloat("2abc") === 2, so the projection is computed from 2.
        var conversions = ByteSizeProjection.Project("2abc", "B");

        Assert.NotNull(conversions);
        Assert.Equal("2", conversions![0].Value);
    }

    [Fact]
    public void Project_degrades_non_finite_magnitude_to_zero()
    {
        // parseFloat("Infinity") is not NaN, so the web computes a (degenerate) grid; every cell folds to 0.
        var conversions = ByteSizeProjection.Project("Infinity", "B");

        Assert.NotNull(conversions);
        Assert.All(conversions!, c => Assert.StartsWith("0", c.Value, StringComparison.Ordinal));
    }

    // ---- View-model: initial (empty) state ------------------------------------------

    [Fact]
    public void Initial_state_is_empty()
    {
        var vm = new ByteSizeConverterViewModel(Localizer);

        Assert.Equal(ByteSizeConverterState.Empty, vm.State);
        Assert.True(vm.IsEmpty);
        Assert.False(vm.HasConversions);
        Assert.False(vm.IsInvalidInput);
        Assert.Null(vm.Conversions);
        Assert.Null(vm.ResultAnnouncement);
        Assert.Equal("B", vm.Unit);
        Assert.Equal(string.Empty, vm.Value);
    }

    // ---- View-model: populated state ------------------------------------------------

    [Fact]
    public void Setting_a_value_populates_the_grid()
    {
        var vm = new ByteSizeConverterViewModel(Localizer) { Value = "1024" };

        Assert.Equal(ByteSizeConverterState.Populated, vm.State);
        Assert.True(vm.HasConversions);
        Assert.False(vm.IsEmpty);
        Assert.False(vm.IsInvalidInput);
        Assert.NotNull(vm.Conversions);
        Assert.Equal(5, vm.Conversions!.Count);
        Assert.True(vm.Conversions[0].IsActive); // default unit B
    }

    [Fact]
    public void Changing_the_unit_moves_the_active_cell()
    {
        var vm = new ByteSizeConverterViewModel(Localizer) { Value = "1024", Unit = "GB" };

        Assert.Equal(ByteSizeConverterState.Populated, vm.State);
        var active = Assert.Single(vm.Conversions!, c => c.IsActive);
        Assert.Equal("GB", active.Unit);
    }

    [Fact]
    public void Non_numeric_value_is_empty_but_flagged_invalid()
    {
        var vm = new ByteSizeConverterViewModel(Localizer) { Value = "abc" };

        Assert.Equal(ByteSizeConverterState.Empty, vm.State);
        Assert.True(vm.IsEmpty);
        Assert.True(vm.IsInvalidInput); // a11y validity affordance — non-empty text that is not a number
    }

    [Fact]
    public void Whitespace_value_is_empty_and_not_invalid()
    {
        var vm = new ByteSizeConverterViewModel(Localizer) { Value = "   " };

        Assert.True(vm.IsEmpty);
        Assert.False(vm.IsInvalidInput); // blank, not malformed
    }

    [Fact]
    public void Clearing_the_value_returns_to_empty()
    {
        var vm = new ByteSizeConverterViewModel(Localizer) { Value = "2048" };
        Assert.True(vm.HasConversions);

        vm.Value = string.Empty;

        Assert.True(vm.IsEmpty);
        Assert.False(vm.IsInvalidInput);
        Assert.Null(vm.ResultAnnouncement);
    }

    [Fact]
    public void Editing_raises_property_changed()
    {
        var vm = new ByteSizeConverterViewModel(Localizer);
        var changed = new List<string>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName ?? string.Empty);

        vm.Value = "10";

        Assert.Contains(nameof(vm.Value), changed);
        Assert.Contains(nameof(vm.State), changed);
        Assert.Contains(nameof(vm.Conversions), changed);
        Assert.Contains(nameof(vm.HasConversions), changed);
    }

    [Fact]
    public void Setting_same_value_is_a_no_op()
    {
        var vm = new ByteSizeConverterViewModel(Localizer) { Value = "10" };
        var changed = 0;
        vm.PropertyChanged += (_, _) => changed++;

        vm.Value = "10";

        Assert.Equal(0, changed);
    }

    // ---- View-model: localized labels + a11y (web t('Byte Size') / t('Value') / ...) -

    [Fact]
    public void Labels_resolve_to_web_literals()
    {
        var vm = new ByteSizeConverterViewModel(Localizer);

        Assert.Equal("Byte Size", vm.Title);
        Assert.Equal("Byte Size Desc", vm.Description);
        Assert.Equal("Value", vm.ValueLabel);
        Assert.Equal("Unit", vm.UnitLabel);
        Assert.Equal("1024", vm.ValueHint);
        Assert.Equal(new[] { "B", "KB", "MB", "GB", "TB" }, vm.UnitOptions);
    }

    [Fact]
    public void Empty_state_has_friendly_strings()
    {
        var vm = new ByteSizeConverterViewModel(Localizer);

        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyTitle));
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public void Result_announcement_summarizes_the_byte_total()
    {
        var vm = new ByteSizeConverterViewModel(Localizer) { Value = "1024", Unit = "B" };

        Assert.NotNull(vm.ResultAnnouncement);
        Assert.StartsWith("1024 B", vm.ResultAnnouncement, StringComparison.Ordinal);
        Assert.Contains("1,024 bytes", vm.ResultAnnouncement, StringComparison.Ordinal);
    }

    // ---- Diagnostics (P1/S11 view.opened) -------------------------------------------

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new ByteSizeConverterDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Contains("view.opened slug=ByteSizeConverter", sink);
        Assert.Equal("ByteSizeConverter", ByteSizeConverterRegistration.Slug);
    }

    private static string[] Values(IReadOnlyList<ByteConversion> conversions)
    {
        var values = new string[conversions.Count];
        for (int i = 0; i < conversions.Count; i++)
        {
            values[i] = conversions[i].Value;
        }

        return values;
    }

    private static string[] Symbols(IReadOnlyList<ByteConversion> conversions)
    {
        var symbols = new string[conversions.Count];
        for (int i = 0; i < conversions.Count; i++)
        {
            symbols[i] = conversions[i].Unit;
        }

        return symbols;
    }
}
