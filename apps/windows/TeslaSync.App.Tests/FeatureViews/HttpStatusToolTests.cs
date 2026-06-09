using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the HttpStatusTool feature-view's UI-thread-free logic — the canonical code
/// catalog (web <c>HTTP_CODES</c>), the code-class → badge-tint classifier (web <c>variant</c> ternary), the
/// search/projection adapter (web <c>filtered</c> memo), the registry/diagnostics, and the state-holder
/// view-model's Ready / Empty transitions plus the localized labels and Narrator names. Mirrors the web spec
/// (web/src/features/admin/components/devtools/tools/HttpStatusTool.tsx). The rendered control's snapshot and
/// accessibility tree are exercised by the WinAppDriver UI-automation suite (deferred to a provisioned runner,
/// per apps/environment-pending-verifications.md); this suite covers every WinUI-free branch.
/// </summary>
public sealed class HttpStatusToolTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static HttpStatusToolViewModel NewViewModel(IHttpStatusCodeSource? source = null) =>
        new(source ?? new HttpStatusCodeSource(), Localizer);

    // ---- Catalog source (web HTTP_CODES parity) -------------------------------------

    [Fact]
    public void Catalog_has_the_nineteen_web_codes_in_order()
    {
        var codes = new HttpStatusCodeSource().GetCodes();

        Assert.Equal(19, codes.Count);
        Assert.Equal(200, codes[0].Code);
        Assert.Equal("OK", codes[0].Text);
        Assert.Equal("Request succeeded", codes[0].Description);
        Assert.Equal(504, codes[^1].Code);
        Assert.Equal("Gateway Timeout", codes[^1].Text);

        // Catalog order is the web declaration order (ascending by code).
        var ascending = codes.Select(c => c.Code).ToArray();
        Assert.Equal(ascending.OrderBy(c => c).ToArray(), ascending);
    }

    [Fact]
    public void Catalog_is_stable_across_reads()
    {
        var source = new HttpStatusCodeSource();
        Assert.Same(source.GetCodes(), source.GetCodes());
    }

    // ---- Classifier (web variant ternary parity) ------------------------------------

    [Theory]
    [InlineData(100, StatusKind.Success)] // web: code < 300 → success
    [InlineData(200, StatusKind.Success)]
    [InlineData(204, StatusKind.Success)]
    [InlineData(299, StatusKind.Success)]
    [InlineData(300, StatusKind.Info)]
    [InlineData(304, StatusKind.Info)]
    [InlineData(399, StatusKind.Info)]
    [InlineData(400, StatusKind.Warning)]
    [InlineData(404, StatusKind.Warning)]
    [InlineData(499, StatusKind.Warning)]
    [InlineData(500, StatusKind.Danger)]
    [InlineData(504, StatusKind.Danger)]
    [InlineData(599, StatusKind.Danger)]
    public void Classifier_maps_code_class_to_badge_tint(int code, StatusKind expected) =>
        Assert.Equal(expected, HttpStatusClassifier.Classify(code));

    // ---- Projection adapter (web filtered memo parity) ------------------------------

    [Fact]
    public void Projection_blank_search_returns_every_code()
    {
        var display = Project(string.Empty);

        Assert.Equal(19, display.Rows.Count);
        Assert.Equal(19, display.TotalCount);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Projection_blank_or_whitespace_returns_all(string? search)
    {
        // Web: if (!search.trim()) return HTTP_CODES
        Assert.Equal(19, Project(search).Rows.Count);
    }

    [Fact]
    public void Projection_filters_by_code_digits()
    {
        var rows = Project("404").Rows;

        var row = Assert.Single(rows);
        Assert.Equal(404, row.Code);
        Assert.Equal("404", row.CodeText);
        Assert.Equal(StatusKind.Warning, row.Status);
    }

    [Fact]
    public void Projection_filters_by_reason_phrase_case_insensitively()
    {
        var rows = Project("GATEWAY").Rows;

        Assert.Equal(new[] { 502, 504 }, rows.Select(r => r.Code).ToArray());
    }

    [Fact]
    public void Projection_filters_by_description()
    {
        var rows = Project("cached").Rows;

        var row = Assert.Single(rows);
        Assert.Equal(304, row.Code);
    }

    [Fact]
    public void Projection_no_match_is_empty_but_keeps_total()
    {
        var display = Project("nonexistent-status");

        Assert.Empty(display.Rows);
        Assert.Equal(19, display.TotalCount);
    }

    [Fact]
    public void Projection_partial_code_prefix_matches_multiple()
    {
        // "50" is a substring of 500, 502, 503, 504 (web String(code).includes(q)).
        var rows = Project("50").Rows;

        Assert.Equal(new[] { 500, 502, 503, 504 }, rows.Select(r => r.Code).ToArray());
    }

    [Fact]
    public void Projection_untrimmed_query_matches_the_web()
    {
        // Web only trims for the empty guard; the substring match uses the raw lower-cased query, so a
        // leading space prevents a code-digit match exactly as the web does.
        Assert.Empty(Project(" 200").Rows);
    }

    [Fact]
    public void Projection_preserves_catalog_order()
    {
        // "e" appears in many descriptions/phrases; the matches keep ascending catalog order.
        var rows = Project("e").Rows;

        var codes = rows.Select(r => r.Code).ToArray();
        Assert.Equal(codes.OrderBy(c => c).ToArray(), codes);
    }

    [Fact]
    public void Projection_composes_row_narrator_name()
    {
        var row = Assert.Single(Project("404").Rows);

        // Narrator name joins code, reason phrase and description.
        Assert.Contains("404", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Not Found", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Resource not found", row.AutomationName, StringComparison.Ordinal);
    }

    // ---- View-model: Ready state ----------------------------------------------------

    [Fact]
    public void Initial_state_is_ready_with_every_code()
    {
        var vm = NewViewModel();

        Assert.Equal(HttpStatusToolState.Ready, vm.State);
        Assert.True(vm.HasResults);
        Assert.Equal(19, vm.MatchCount);
        Assert.Equal(19, vm.TotalCount);
    }

    // ---- View-model: Empty state ----------------------------------------------------

    [Fact]
    public void No_match_search_flips_to_empty_then_back_to_ready()
    {
        var vm = NewViewModel();

        vm.SearchText = "no-such-code";
        Assert.Equal(HttpStatusToolState.Empty, vm.State);
        Assert.False(vm.HasResults);
        Assert.Equal(0, vm.MatchCount);
        Assert.Equal(19, vm.TotalCount); // catalog size is unaffected by the filter

        vm.SearchText = string.Empty;
        Assert.Equal(HttpStatusToolState.Ready, vm.State);
        Assert.True(vm.HasResults);
        Assert.Equal(19, vm.MatchCount);
    }

    [Fact]
    public void Search_narrows_the_display()
    {
        var vm = NewViewModel();

        vm.SearchText = "timeout";

        Assert.Equal(HttpStatusToolState.Ready, vm.State);
        Assert.Equal(new[] { 408, 504 }, vm.Display.Rows.Select(r => r.Code).ToArray());
    }

    [Fact]
    public void Search_setter_is_ordinal_no_op_when_unchanged()
    {
        var vm = NewViewModel();
        int displayChanges = 0;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(HttpStatusToolViewModel.Display))
            {
                displayChanges++;
            }
        };

        vm.SearchText = "404";
        vm.SearchText = "404"; // identical — must not reproject

        Assert.Equal(1, displayChanges);
    }

    [Fact]
    public void Search_setter_coerces_null_to_empty()
    {
        var vm = NewViewModel();
        vm.SearchText = "404";

        vm.SearchText = null!;

        Assert.Equal(string.Empty, vm.SearchText);
        Assert.Equal(HttpStatusToolState.Ready, vm.State);
        Assert.Equal(19, vm.MatchCount);
    }

    // ---- Localized labels + a11y names (web t('…')) ---------------------------------

    [Fact]
    public void Labels_resolve_to_web_literals()
    {
        var vm = NewViewModel();

        Assert.Equal("Http Status", vm.Title);
        Assert.Equal("Http Status Desc", vm.Description);
        Assert.Equal("Search Codes", vm.SearchHint);
        Assert.Equal("Status Code", vm.StatusCodeHeader);
        Assert.Equal("Status Text", vm.StatusTextHeader);
        Assert.Equal("Status Desc", vm.StatusDescHeader);
        Assert.Equal("No data", vm.EmptyMessage);
    }

    [Fact]
    public void Header_glyph_and_accent_match_the_web()
    {
        Assert.Equal("\uEC05", HttpStatusToolRegistration.Glyph);      // web Lucide Network icon
        Assert.Equal("amber", HttpStatusToolRegistration.AccentColor); // web color="amber"
    }

    // ---- Diagnostics (P1/S11 view.opened) -------------------------------------------

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new HttpStatusToolDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Contains("view.opened slug=HttpStatusTool", sink);
        Assert.Equal("HttpStatusTool", HttpStatusToolRegistration.Slug);
    }

    private static HttpStatusDisplay Project(string? search) =>
        HttpStatusProjection.Project(new HttpStatusCodeSource().GetCodes(), search);
}
