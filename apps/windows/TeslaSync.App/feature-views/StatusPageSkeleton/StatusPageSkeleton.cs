using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.FeatureViews.SystemStatus;

/// <summary>
/// The native WinUI 3 <c>StatusPageSkeleton</c> feature surface — a parity port of
/// web/src/features/system/components/status/StatusPageSkeleton.tsx. The web source is a pure presentational
/// scaffold (no props, no data, no i18n strings beyond its accessible name and no conditional branches) that
/// renders the System Status page's loading chrome: a hero panel (avatar / title / subtitle / action), an
/// eight-chip overflow-clipped bar, three titled list panels (six health rows, two action items, five
/// resources) and four accordion summary panels — every region built from shimmering <see cref="TsSkeleton"/>
/// blocks inside tokenized <see cref="TsGlassPanel"/> surfaces. This port reproduces that single render path
/// declaratively from the WinUI-free <see cref="StatusPageSkeletonSpec"/>, so every dimension and count matches
/// the web source row for row, inside a centred 768px column (web <c>max-w-3xl mx-auto</c>). The whole scaffold
/// fades in through <see cref="TsFadeIn"/> (honouring reduce-motion) and each shimmer block honours reduce-motion
/// individually via <see cref="MotionPreference.ReduceMotion"/>. The decorative blocks are hidden from Narrator;
/// the surface instead exposes a single localized "Loading" name and announces it through a polite live region
/// so the page is never a silent shimmer to assistive technology. The view performs no HTTP and owns no query
/// lifecycle — it is the loading state the System Status page shows while its data resolves, which is why the
/// web source has only this one state and no empty / error / stale / offline branches.
/// </summary>
public sealed partial class StatusPageSkeleton : ContentControl
{
    private readonly ILocalizer _localizer;
    private readonly StatusPageSkeletonDiagnostics _diagnostics;
    private readonly StatusPageSkeletonSpec _spec;

    private FrameworkElement? _liveRegion;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, optional diagnostics and an optional layout spec.</summary>
    /// <param name="localizer">The i18n facade the accessible "Loading" name resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="spec">The scaffold geometry; defaults to <see cref="StatusPageSkeletonSpec.Default"/>.</param>
    public StatusPageSkeleton(
        ILocalizer localizer,
        StatusPageSkeletonDiagnostics? diagnostics = null,
        StatusPageSkeletonSpec? spec = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new StatusPageSkeletonDiagnostics();
        _spec = spec ?? StatusPageSkeletonSpec.Default;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>StatusPageSkeleton</c>).</summary>
    public static string Slug => StatusPageSkeletonRegistration.Slug;

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
        string loadingLabel = StatusPageSkeletonRegistration.LoadingLabel(_localizer);

        // Web outer div: `space-y-5 max-w-3xl mx-auto`. A Stretch column capped at MaxWidth is centred by WinUI
        // when the host is wider than the cap, reproducing `max-w-3xl mx-auto`; `space-y-5` is the region gap.
        var column = new StackPanel
        {
            Spacing = _spec.RegionSpacing,
            MaxWidth = _spec.MaxWidth,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        column.Children.Add(BuildHero(_spec.Hero, reduce));
        column.Children.Add(BuildChipBar(_spec.Chips, reduce));
        column.Children.Add(BuildTitledRows(_spec.Health, reduce));
        column.Children.Add(BuildTitledRows(_spec.ActionItems, reduce));
        column.Children.Add(BuildTitledRows(_spec.Resources, reduce));
        for (var i = 0; i < _spec.Accordion.Count; i++)
        {
            column.Children.Add(BuildAccordionPanel(_spec.Accordion, reduce));
        }

        // The shimmer blocks are decorative; the surface speaks a single "Loading" name through a polite live
        // region so Narrator announces the page is loading (web role="status" / aria-label) without reading
        // every block.
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

    // ── Hero: avatar, title/subtitle column, right-aligned action (web flex items-start gap-4) ──────────────
    private static TsGlassPanel BuildHero(HeroSpec hero, bool reduce)
    {
        var grid = new Grid { ColumnSpacing = hero.ColumnGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var avatar = Block(hero.Avatar, reduce);
        avatar.VerticalAlignment = VerticalAlignment.Top;
        Grid.SetColumn(avatar, 0);
        grid.Children.Add(avatar);

        var lines = new StackPanel { Spacing = hero.LineGap, VerticalAlignment = VerticalAlignment.Top };
        lines.Children.Add(Block(hero.Title, reduce));
        lines.Children.Add(Block(hero.Subtitle, reduce));
        Grid.SetColumn(lines, 1);
        grid.Children.Add(lines);

        var action = Block(hero.Action, reduce);
        action.VerticalAlignment = VerticalAlignment.Top;
        action.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(action, 2);
        grid.Children.Add(action);

        return new TsGlassPanel { Padding = new Thickness(hero.Padding), Content = grid };
    }

    // ── Chip bar: a row of fixed-width pills, surplus clipped (web flex gap-2 overflow-hidden) ──────────────
    private static Border BuildChipBar(ChipBarSpec chips, bool reduce)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = chips.Gap,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        for (var i = 0; i < chips.Count; i++)
        {
            row.Children.Add(Block(chips.Chip, reduce));
        }

        // Web `overflow-hidden`: the chips overflow the row and the surplus is clipped (never wraps or scrolls).
        var host = new Border { Child = row, HorizontalAlignment = HorizontalAlignment.Stretch };
        host.SizeChanged += OnChipBarSizeChanged;
        return host;
    }

    private static void OnChipBarSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (sender is Border host)
        {
            host.Clip = new RectangleGeometry { Rect = new Rect(0, 0, host.ActualWidth, host.ActualHeight) };
        }
    }

    // ── Titled list: a title block over a stack of equal full-width rows (web GlassPanel + space-y-*) ───────
    private static TsGlassPanel BuildTitledRows(TitledRowsSpec section, bool reduce)
    {
        var outer = new StackPanel();
        outer.Children.Add(Block(section.Title, reduce));

        var rows = new StackPanel
        {
            Spacing = section.RowGap,
            Margin = new Thickness(0, section.HeaderGap, 0, 0),
        };
        for (var i = 0; i < section.RowCount; i++)
        {
            rows.Children.Add(Block(section.Row, reduce));
        }

        outer.Children.Add(rows);
        return new TsGlassPanel { Padding = new Thickness(section.Padding), Content = outer };
    }

    // ── Accordion summary: icon, title + sub-line column, trailing block (web flex items-center gap-3) ──────
    private static TsGlassPanel BuildAccordionPanel(AccordionSpec accordion, bool reduce)
    {
        var grid = new Grid { ColumnSpacing = accordion.ColumnGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = Block(accordion.Icon, reduce);
        icon.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        var lines = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        lines.Children.Add(Block(accordion.Title, reduce));
        lines.Children.Add(WithTopGap(Block(accordion.Subtitle, reduce), accordion.SubtitleGap));
        Grid.SetColumn(lines, 1);
        grid.Children.Add(lines);

        var trailing = Block(accordion.Trailing, reduce);
        trailing.VerticalAlignment = VerticalAlignment.Center;
        trailing.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(trailing, 2);
        grid.Children.Add(trailing);

        return new TsGlassPanel { Padding = new Thickness(accordion.Padding), Content = grid };
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
