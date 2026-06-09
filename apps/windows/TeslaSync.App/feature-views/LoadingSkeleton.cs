using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>LoadingSkeleton</c> feature surface — a parity port of
/// web/src/features/charging/components/cost-analysis/LoadingSkeleton.tsx. The web source is a pure
/// presentational scaffold (no props, no data, no i18n strings, no conditional branches) that renders the
/// cost-analysis page's loading chrome: a header (title / subtitle / action), a responsive six-card stat grid,
/// a two-panel chart row and a five-row table — every region built from shimmering <see cref="TsSkeleton"/>
/// blocks inside tokenized <see cref="TsGlassPanel"/> surfaces. This port reproduces that single render path
/// declaratively from the WinUI-free <see cref="LoadingSkeletonSpec"/>, so every dimension and count matches
/// the web source row for row. The whole scaffold fades in through <see cref="TsFadeIn"/> (honouring
/// reduce-motion) and each shimmer block honours reduce-motion individually via
/// <see cref="MotionPreference.ReduceMotion"/>. The decorative blocks are hidden from Narrator; the surface
/// instead exposes a single localized "Loading" name and announces it through a polite live region so the page
/// is never a silent shimmer to assistive technology. The view performs no HTTP and owns no query lifecycle —
/// it is the loading state other surfaces show while their data resolves.
/// </summary>
public sealed partial class LoadingSkeleton : ContentControl
{
    private readonly ILocalizer _localizer;
    private readonly LoadingSkeletonDiagnostics _diagnostics;
    private readonly LoadingSkeletonSpec _spec;

    private FrameworkElement? _liveRegion;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, optional diagnostics and an optional layout spec.</summary>
    /// <param name="localizer">The i18n facade the accessible "Loading" name resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="spec">The scaffold geometry; defaults to <see cref="LoadingSkeletonSpec.Default"/>.</param>
    public LoadingSkeleton(
        ILocalizer localizer,
        LoadingSkeletonDiagnostics? diagnostics = null,
        LoadingSkeletonSpec? spec = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new LoadingSkeletonDiagnostics();
        _spec = spec ?? LoadingSkeletonSpec.Default;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>LoadingSkeleton</c>).</summary>
    public static string Slug => LoadingSkeletonRegistration.Slug;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_liveRegion is not null)
        {
            LiveRegion.Announce(_liveRegion);
        }

        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        bool reduce = MotionPreference.ReduceMotion;
        string loadingLabel = LoadingSkeletonRegistration.LoadingLabel(_localizer);

        var column = new StackPanel { Spacing = _spec.ContentSpacing };
        column.Children.Add(BuildHeader(_spec.Header, reduce));
        column.Children.Add(BuildCards(_spec.Cards, reduce));
        column.Children.Add(BuildCharts(_spec.Charts, reduce));
        column.Children.Add(BuildTable(_spec.Table, reduce));

        // The shimmer blocks are decorative; the surface speaks a single "Loading" name through a polite live
        // region so Narrator announces the page is loading without reading every block.
        AutomationProperties.SetName(this, loadingLabel);
        AutomationProperties.SetName(column, loadingLabel);
        LiveRegion.Configure(column);
        _liveRegion = column;

        var padded = new Border
        {
            Padding = new Thickness(_spec.OuterPadding),
            Child = column,
        };

        Content = new TsFadeIn { Content = padded };
    }

    // ── Header: title + subtitle column, right-aligned action (web flex … justify-between) ────────────────
    private static Grid BuildHeader(HeaderSpec header, bool reduce)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(Block(header.Title, reduce));
        left.Children.Add(WithTopGap(Block(header.Subtitle, reduce), header.SubtitleGap));
        Grid.SetColumn(left, 0);
        grid.Children.Add(left);

        var action = Block(header.Action, reduce);
        action.HorizontalAlignment = HorizontalAlignment.Right;
        action.VerticalAlignment = VerticalAlignment.Center;
        action.Margin = new Thickness(header.ColumnGap, 0, 0, 0);
        Grid.SetColumn(action, 1);
        grid.Children.Add(action);

        return grid;
    }

    // ── Cards: a responsive grid of six glass panels, each three stacked blocks ──────────────────────────
    private static TsGrid BuildCards(CardsSpec cards, bool reduce)
    {
        var grid = new TsGrid { Columns = cards.Columns, Gutter = cards.Gap, ItemMinWidth = 150 };
        for (var i = 0; i < cards.Count; i++)
        {
            grid.Children.Add(BuildCardPanel(cards, reduce));
        }

        return grid;
    }

    private static TsGlassPanel BuildCardPanel(CardsSpec cards, bool reduce)
    {
        var stack = new StackPanel();
        foreach (var line in cards.Lines)
        {
            stack.Children.Add(WithTopGap(Block(line.Block, reduce), line.TopGap));
        }

        return new TsGlassPanel { Padding = new Thickness(cards.Padding), Content = stack };
    }

    // ── Charts: two glass panels, a title block over a tall body block ───────────────────────────────────
    private static TsGrid BuildCharts(ChartsSpec charts, bool reduce)
    {
        var grid = new TsGrid { Columns = charts.Columns, Gutter = charts.Gap, ItemMinWidth = 280 };
        for (var i = 0; i < charts.Count; i++)
        {
            var stack = new StackPanel();
            stack.Children.Add(Block(charts.Title, reduce));
            stack.Children.Add(WithTopGap(Block(charts.Body, reduce), charts.BodyGap));
            grid.Children.Add(new TsGlassPanel { Padding = new Thickness(charts.Padding), Content = stack });
        }

        return grid;
    }

    // ── Table: one glass panel, a title block over a stack of row blocks ─────────────────────────────────
    private static TsGlassPanel BuildTable(TableSpec table, bool reduce)
    {
        var outer = new StackPanel();
        outer.Children.Add(Block(table.Title, reduce));

        var rows = new StackPanel
        {
            Spacing = table.RowGap,
            Margin = new Thickness(0, table.HeaderGap, 0, 0),
        };
        for (var i = 0; i < table.RowCount; i++)
        {
            rows.Children.Add(Block(table.Row, reduce));
        }

        outer.Children.Add(rows);
        return new TsGlassPanel { Padding = new Thickness(table.Padding), Content = outer };
    }

    // ── One shimmer block (handles fixed / stretch / fraction widths) ────────────────────────────────────
    private static FrameworkElement Block(SkeletonBlock block, bool reduce)
    {
        var skeleton = new TsSkeleton
        {
            BlockHeight = block.Height,
            Radius = block.ResolveRadius(),
            ReduceMotion = reduce,
            BlockWidth = block.WidthMode == SkeletonWidth.Fixed ? block.Width : double.NaN,
        };

        if (block.WidthMode != SkeletonWidth.Fraction)
        {
            return skeleton;
        }

        // Percentage width (web width="{n}%"): allocate the fraction with a star-weighted grid so the block
        // keeps its proportion as the panel resizes instead of being pinned to a fixed pixel width.
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(block.Width, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition
        {
            Width = new GridLength(Math.Max(0, 1 - block.Width), GridUnitType.Star),
        });
        Grid.SetColumn(skeleton, 0);
        grid.Children.Add(skeleton);
        return grid;
    }

    private static FrameworkElement WithTopGap(FrameworkElement element, double gap)
    {
        if (gap > 0)
        {
            element.Margin = new Thickness(0, gap, 0, 0);
        }

        return element;
    }
}
