using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ColorConverter feature-view's UI-thread-free logic — the hex parsing + HSL
/// conversion (the web <c>parsed</c> memo and the <c>rgbToHsl</c> helper), the render-ready projection
/// (the swatch + RGB / HSL / HEX cells), the registry / diagnostics metadata, and the state-holder
/// view-model's per-state transitions (ready / empty), localized labels and Narrator names. Mirrors the web
/// spec (web/src/features/admin/components/devtools/tools/ColorConverter.tsx and
/// web/src/features/admin/components/devtools/helpers.ts).
/// </summary>
public sealed class ColorConverterTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ColorConverterViewModel NewViewModel(ILocalizer? localizer = null) =>
        new(localizer ?? Localizer);

    // ---- rgbToHsl conversion (web helpers.ts parity) -------------------------------

    [Theory]
    [InlineData(59, 130, 246, 217, 91, 60)]   // web sample #3b82f6
    [InlineData(255, 255, 255, 0, 0, 100)]    // white
    [InlineData(0, 0, 0, 0, 0, 0)]            // black
    [InlineData(255, 0, 0, 0, 100, 50)]       // red
    [InlineData(0, 255, 0, 120, 100, 50)]     // green
    [InlineData(0, 0, 255, 240, 100, 50)]     // blue
    [InlineData(128, 128, 128, 0, 0, 50)]     // mid grey
    public void RgbToHsl_matches_web_helper(int r, int g, int b, int h, int s, int l)
    {
        var hsl = ColorMath.RgbToHsl(r, g, b);

        Assert.Equal(h, hsl.H);
        Assert.Equal(s, hsl.S);
        Assert.Equal(l, hsl.L);
    }

    // ---- Hex parsing (web parsed memo + JS parseInt parity) ------------------------

    [Fact]
    public void TryParseHex_parses_six_digit_hex_with_hash()
    {
        var rgb = ColorMath.TryParseHex("#3b82f6");

        Assert.Equal(new RgbColor(59, 130, 246), rgb);
    }

    [Fact]
    public void TryParseHex_parses_six_digit_hex_without_hash()
    {
        Assert.Equal(new RgbColor(59, 130, 246), ColorMath.TryParseHex("3b82f6"));
    }

    [Fact]
    public void TryParseHex_is_case_insensitive()
    {
        Assert.Equal(new RgbColor(255, 255, 255), ColorMath.TryParseHex("#FFFFFF"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("#3b82f")]      // too short (5)
    [InlineData("#3b82f6a")]    // too long (7)
    [InlineData("##3b82f6")]    // replace('#','') removes only the first -> "#3b82f6" (7) -> invalid
    [InlineData("zzzzzz")]      // no leading hex digit in the first pair -> NaN
    [InlineData("g38216")]      // leading non-hex -> NaN
    public void TryParseHex_rejects_invalid_input(string? hex)
    {
        Assert.Null(ColorMath.TryParseHex(hex));
    }

    [Fact]
    public void TryParseHex_reproduces_js_parseInt_partial_leniency()
    {
        // Web parity: parseInt('3g', 16) === 3 (parses the leading hex run, not NaN).
        Assert.Equal(new RgbColor(3, 130, 246), ColorMath.TryParseHex("3g82f6"));
    }

    [Fact]
    public void TryParseHex_reproduces_js_parseInt_whitespace_trim()
    {
        // Web parity: parseInt(' f', 16) === 15 (leading whitespace is skipped).
        Assert.Equal(new RgbColor(15, 255, 255), ColorMath.TryParseHex(" fffff"));
    }

    // ---- Value formatting (web template strings) -----------------------------------

    [Fact]
    public void FormatRgb_matches_web_template()
    {
        Assert.Equal("rgb(59, 130, 246)", ColorConverterProjection.FormatRgb(new RgbColor(59, 130, 246)));
    }

    [Fact]
    public void FormatHsl_matches_web_template()
    {
        Assert.Equal("hsl(217, 91%, 60%)", ColorConverterProjection.FormatHsl(new HslColor(217, 91, 60)));
    }

    // ---- Projection adapter (web parsed -> result tiles) ---------------------------

    [Fact]
    public void Project_valid_hex_yields_swatch_and_three_cells_in_web_order()
    {
        var display = ColorConverterProjection.Project("#3b82f6");

        Assert.True(display.HasResult);
        Assert.Equal(new RgbColor(59, 130, 246), display.Swatch);
        Assert.Equal(3, display.Cells.Count);

        Assert.Equal("RGB", display.Cells[0].Label);
        Assert.Equal("rgb(59, 130, 246)", display.Cells[0].Value);
        Assert.Equal("HSL", display.Cells[1].Label);
        Assert.Equal("hsl(217, 91%, 60%)", display.Cells[1].Value);
        Assert.Equal("HEX", display.Cells[2].Label);
        Assert.Equal("#3b82f6", display.Cells[2].Value);
    }

    [Fact]
    public void Project_hex_cell_echoes_raw_input()
    {
        // Web shows {hex} verbatim in the HEX tile, so the missing '#' is preserved.
        var display = ColorConverterProjection.Project("3b82f6");

        Assert.Equal("3b82f6", display.Cells[2].Value);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("nope")]
    [InlineData("#3b82f")]
    public void Project_invalid_hex_is_empty(string? hex)
    {
        var display = ColorConverterProjection.Project(hex);

        Assert.False(display.HasResult);
        Assert.Empty(display.Cells);
        Assert.Null(display.Swatch);
    }

    [Fact]
    public void Display_empty_singleton_has_no_result()
    {
        Assert.False(ColorConverterDisplay.Empty.HasResult);
        Assert.Empty(ColorConverterDisplay.Empty.Cells);
        Assert.Null(ColorConverterDisplay.Empty.Swatch);
    }

    // ---- View-model: initial (ready) state -----------------------------------------

    [Fact]
    public void ViewModel_starts_ready_with_the_web_default_hex()
    {
        var vm = NewViewModel();

        Assert.Equal("#3b82f6", vm.Hex);
        Assert.Equal(ColorConverterState.Ready, vm.State);
        Assert.True(vm.HasResult);
        Assert.Equal(3, vm.Cells.Count);
        Assert.Equal(new RgbColor(59, 130, 246), vm.Swatch);
    }

    // ---- View-model: empty state ---------------------------------------------------

    [Fact]
    public void ViewModel_invalid_hex_is_empty()
    {
        var vm = NewViewModel();

        vm.Hex = "#12";

        Assert.Equal(ColorConverterState.Empty, vm.State);
        Assert.False(vm.HasResult);
        Assert.Empty(vm.Cells);
        Assert.Null(vm.Swatch);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public void ViewModel_recovers_to_ready_after_invalid_input()
    {
        var vm = NewViewModel();

        vm.Hex = "bad";
        vm.Hex = "#00ff00";

        Assert.Equal(ColorConverterState.Ready, vm.State);
        Assert.Equal("hsl(120, 100%, 50%)", vm.Cells[1].Value);
        Assert.Equal(new RgbColor(0, 255, 0), vm.Swatch);
    }

    // ---- View-model: change notifications ------------------------------------------

    [Fact]
    public void ViewModel_hex_change_raises_display_and_state()
    {
        var vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Hex = "#abcabc";

        Assert.Contains(nameof(ColorConverterViewModel.Hex), raised);
        Assert.Contains(nameof(ColorConverterViewModel.Display), raised);
        Assert.Contains(nameof(ColorConverterViewModel.State), raised);
    }

    [Fact]
    public void ViewModel_hex_set_to_same_value_is_a_noop()
    {
        var vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Hex = "#3b82f6"; // already the default

        Assert.Empty(raised);
    }

    [Fact]
    public void ViewModel_announcement_carries_result_then_empty_message()
    {
        var vm = NewViewModel();

        Assert.Contains("rgb(59, 130, 246)", vm.LastAnnouncement!, StringComparison.Ordinal);

        vm.Hex = "bad";

        Assert.Equal(vm.EmptyMessage, vm.LastAnnouncement);
    }

    // ---- Localized labels + a11y names (web t('Color Converter') / t('Hex Color')) --

    [Fact]
    public void ViewModel_labels_resolve_to_web_literals()
    {
        var vm = NewViewModel();

        Assert.Equal("Color Converter", vm.Title);
        Assert.Equal("Color Converter Desc", vm.Description);
        Assert.Equal("Hex Color", vm.HexLabel);
        Assert.Equal("Copy", vm.CopyLabel);
        Assert.Equal("Copied", vm.CopiedLabel);
    }

    [Fact]
    public void ViewModel_labels_flow_through_the_localizer()
    {
        var vm = NewViewModel(new PrefixLocalizer());

        // Every label came through the i18n facade (prefixed), not a hard-coded literal.
        Assert.Equal("L:Color Converter", vm.Title);
        Assert.Equal("L:Color Converter Desc", vm.Description);
        Assert.Equal("L:Hex Color", vm.HexLabel);
        Assert.Equal("L:common.copyButton.copy", vm.CopyLabel);
        Assert.Equal("L:devtools.colorConverter.empty", vm.EmptyMessage);
    }

    [Fact]
    public void ViewModel_swatch_name_names_the_current_hex()
    {
        var vm = NewViewModel();

        Assert.Contains("#3b82f6", vm.SwatchName);

        vm.Hex = "#abcdef";

        Assert.Contains("#abcdef", vm.SwatchName);
    }

    [Fact]
    public void ViewModel_copy_name_is_scoped_to_the_cell_format()
    {
        var vm = NewViewModel();
        var cell = vm.Cells[0];

        Assert.False(string.IsNullOrWhiteSpace(vm.CopyName(cell)));
        Assert.Contains(cell.Label, vm.CopyName(cell), StringComparison.Ordinal);
    }

    [Fact]
    public void ViewModel_copy_name_rejects_null_cell()
    {
        var vm = NewViewModel();

        Assert.Throws<ArgumentNullException>(() => vm.CopyName(null!));
    }

    [Fact]
    public void ViewModel_rejects_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => new ColorConverterViewModel(null!));
    }

    // ---- Registry + diagnostics (web color tool metadata, P1/S11 view.opened) -------

    [Fact]
    public void Registration_metadata_is_stable_and_semantic()
    {
        Assert.Equal("ColorConverter", ColorConverterRegistration.Slug);
        Assert.Equal("#3b82f6", ColorConverterRegistration.DefaultHex);
        Assert.Equal("\uE790", ColorConverterRegistration.Glyph);
        Assert.False(string.IsNullOrEmpty(ColorConverterRegistration.Glyph));

        Assert.StartsWith("TsColor", ColorConverterRegistration.AccentBrushKey, StringComparison.Ordinal);
        Assert.EndsWith("Brush", ColorConverterRegistration.AccentBrushKey, StringComparison.Ordinal);
        Assert.DoesNotContain("neon", ColorConverterRegistration.AccentBrushKey, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new ColorConverterDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ColorConverter", Assert.Single(sink));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new ColorConverterDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ---- Test doubles --------------------------------------------------------------

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
