using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Motion;
using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Theme;
using Xunit;

namespace TeslaSync.App.Tests.W9;

/// <summary>
/// W9-0001 consolidated component-state matrix: one focused, behavioural assertion per state every
/// W2 surface must be able to render — loading, empty, error, disabled, focused, validation,
/// accessible labels, high contrast and reduced motion — proving each state is backed by a headless,
/// unit-tested model rather than by WinUI markup alone.
/// </summary>
public sealed class ComponentStateMatrixTests
{
    [Fact]
    public void LoadingEmptyError_AreMutuallyExclusiveAsyncStates()
    {
        var state = new AsyncState<IReadOnlyList<int>>();

        state.SetLoading();
        Assert.True(state.IsLoading);
        Assert.False(state.HasData || state.IsEmpty || state.HasError);

        state.SetLoaded([], list => list.Count == 0);
        Assert.Equal(LoadStatus.Empty, state.Status);

        state.SetError("network down");
        Assert.True(state.HasError);
        Assert.True(state.CanRetry);
        Assert.Equal("network down", state.ErrorMessage);
    }

    [Fact]
    public void Disabled_PaginationEdgesGateNavigation()
    {
        var page = new PaginationState { PageSize = 10, Total = 25 };

        // First page: "previous" is disabled, "next" is enabled.
        Assert.False(page.CanGoPrevious);
        Assert.True(page.CanGoNext);

        page.Last();

        // Last page: "next" is disabled, "previous" is enabled.
        Assert.False(page.CanGoNext);
        Assert.True(page.CanGoPrevious);
    }

    [Fact]
    public void Disabled_OptionsAreNotCommittable()
    {
        var combo = new ComboboxState([
            new ComboOption("a", "Active"),
            new ComboOption("b", "Blocked", Disabled: true),
        ]);

        combo.MoveHighlight(1); // highlight the disabled option
        Assert.Equal("Blocked", combo.HighlightedOption!.Label);
        Assert.Null(combo.CommitHighlight()); // a disabled option cannot be committed
        Assert.Null(combo.SelectedValue);
    }

    [Fact]
    public void Focused_HighlightCursorMovesAndCommits()
    {
        var combo = new ComboboxState([
            new ComboOption("a", "Alpha"),
            new ComboOption("b", "Bravo"),
        ]);

        Assert.Equal(0, combo.HighlightIndex); // first option focused by default
        combo.MoveHighlight(1);
        Assert.Equal("Bravo", combo.HighlightedOption!.Label);
        Assert.Equal("b", combo.CommitHighlight());
        Assert.Equal("b", combo.SelectedValue);
    }

    [Fact]
    public void Validation_AllReportsFirstFailingField()
    {
        var ok = Validators.All(
            Validators.Required("name", "name"),
            Validators.InRange(5, 0, 10, "count"));
        Assert.True(ok.IsValid);

        var bad = Validators.All(
            Validators.Required("name", "name"),
            Validators.InRange(99, 0, 10, "count"));
        Assert.False(bad.IsValid);
        Assert.Equal("count", bad.Error);
    }

    [Fact]
    public void AccessibleLabels_ChartExposesSpokenSummaryAndDataTable()
    {
        IReadOnlyList<ChartSeries> series =
        [
            new ChartSeries("Speed", [new ChartPoint(0, 10), new ChartPoint(1, 30)]) { Unit = "km/h", Decimals = 0 },
        ];

        var summary = ChartAccessibility.Summarize("Trip", series);
        Assert.Contains("Trip: 1 series.", summary, StringComparison.Ordinal);
        Assert.Contains("range 10 km/h to 30 km/h", summary, StringComparison.Ordinal);

        var table = ChartAccessibility.ToDataView(series);
        Assert.Equal(["x", "Speed"], table.Columns);
        Assert.Equal(2, table.Rows.Count);

        // An empty series still yields a non-visual description, never a blank control.
        Assert.Contains("no data available", ChartAccessibility.Summarize("Trip", []), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(AppThemePreference.Light)]
    [InlineData(AppThemePreference.Dark)]
    [InlineData(AppThemePreference.System)]
    public void HighContrast_OverridesPreferenceAndDefersToSystemPalette(AppThemePreference preference)
    {
        var normal = ThemeResolver.Resolve(preference, systemHighContrast: false);
        var contrast = ThemeResolver.Resolve(preference, systemHighContrast: true);

        Assert.NotEqual(ThemeVariant.HighContrast, normal);
        Assert.Equal(ThemeVariant.HighContrast, contrast);
        Assert.True(ThemeResolver.DefersToSystemPalette(contrast));
    }

    [Fact]
    public void ReducedMotion_CollapsesEveryAnimationToZero()
    {
        Assert.Equal(0, MotionDuration.Resolve(reduce: true));
        Assert.False(MotionDuration.ShouldAnimate(reduce: true));
        Assert.Equal(0, MotionDuration.StaggerStepMs(reduce: true));

        // ...and runs the full duration when motion is allowed.
        Assert.Equal(MotionDuration.DefaultMs, MotionDuration.Resolve(reduce: false));
        Assert.True(MotionDuration.ShouldAnimate(reduce: false));
    }
}
