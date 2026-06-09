using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.IngestXRay;

/// <summary>
/// The native WinUI 3 <c>XRayFieldsTable</c> feature surface — a parity port of
/// web/src/features/admin/components/ingest-xray/XRayFieldsTable.tsx. It is a presentational control:
/// assign a <see cref="Model"/> (the parent's <c>useIngestXRay</c> rows + loading flag) and it renders
/// exactly one of the web branches — <see cref="XRayFieldsTableState.Loading"/> (column header + shimmering
/// skeleton rows, announced as a live region with the "Loading…" copy),
/// <see cref="XRayFieldsTableState.Empty"/> (column header + a friendly <see cref="TsEmptyState"/> carrying
/// the "No samples…" copy), or <see cref="XRayFieldsTableState.Data"/> (the four-column table — a monospace
/// field name, the right-aligned grouped sample count, the relative last-seen time, and a neutral value-kind
/// chip — with keyboard-operable sortable headers and a 50-row pager). The view never performs HTTP; branch
/// selection, sorting, formatting and label resolution all happen in the WinUI-free
/// <see cref="XRayFieldsTableProjection"/>. Every string resolves through the i18n facade and every
/// interactive element carries a Narrator name.
/// </summary>
public sealed partial class XRayFieldsTable : ContentControl
{
    private const string SortAscendingGlyph = "\uE70E"; // Segoe Fluent — chevron up
    private const string SortDescendingGlyph = "\uE70D"; // Segoe Fluent — chevron down
    private const int LoadingRowCount = 6;
    private const double SamplesColumnWidth = 110;
    private const double LastSeenColumnWidth = 150;
    private const double KindColumnWidth = 140;

    private readonly ILocalizer _localizer;
    private readonly XRayFieldsTableDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;
    private readonly PaginationState _pager = new() { PageSize = XRayFieldsTableProjection.PageSize };

    private XRayFieldsTableModel _model;
    private XRayFieldsSort _sort = XRayFieldsSort.Default;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics/clock.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="XRayFieldsTableModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">Injectable clock for deterministic relative-time formatting in tests.</param>
    public XRayFieldsTable(
        ILocalizer localizer,
        XRayFieldsTableModel? model = null,
        XRayFieldsTableDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? XRayFieldsTableModel.Empty;
        _diagnostics = diagnostics ?? new XRayFieldsTableDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>XRayFieldsTable</c>).</summary>
    public static string Slug => XRayFieldsTableRegistration.Slug;

    /// <summary>The render model; reassigning re-projects, resets to the first page, and re-renders.</summary>
    public XRayFieldsTableModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            _pager.Page = 1;
            Render();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnToggleSort(string key)
    {
        _sort = _sort.Toggle(key);
        _pager.Page = 1;
        Render();
    }

    private void Render()
    {
        var display = XRayFieldsTableProjection.Project(_model, _sort, _localizer, _clock());

        UIElement surface = display.State switch
        {
            XRayFieldsTableState.Loading => BuildLoading(display),
            XRayFieldsTableState.Empty => BuildEmpty(display),
            _ => BuildData(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Data (web data.length > 0) ──────────────────────────────────────────────────────────────────
    private StackPanel BuildData(XRayFieldsTableDisplay display)
    {
        var root = new StackPanel { Spacing = 0 };
        root.Children.Add(BuildHeader(display, interactive: true));

        _pager.PageSize = XRayFieldsTableProjection.PageSize;
        _pager.Total = display.Rows.Count;
        foreach (var row in _pager.Slice(display.Rows))
        {
            root.Children.Add(BuildRow(row));
        }

        if (display.Rows.Count > XRayFieldsTableProjection.PageSize)
        {
            root.Children.Add(BuildPager(display.Rows.Count));
        }

        return root;
    }

    // ── Loading (web empty message = "Loading…") ────────────────────────────────────────────────────
    private StackPanel BuildLoading(XRayFieldsTableDisplay display)
    {
        var root = new StackPanel { Spacing = 0 };
        root.Children.Add(BuildHeader(display, interactive: false));

        bool reduceMotion = ReduceMotion();
        var body = new StackPanel { Spacing = 10, Padding = new Thickness(8, 10, 8, 10) };
        for (int i = 0; i < LoadingRowCount; i++)
        {
            body.Children.Add(new TsSkeleton { BlockHeight = 16, ReduceMotion = reduceMotion });
        }

        root.Children.Add(body);
        AutomationProperties.SetName(root, display.AutomationName);
        LiveRegion.Configure(root);
        LiveRegion.Announce(root);
        return root;
    }

    // ── Empty (web empty message = "No samples…") ───────────────────────────────────────────────────
    private StackPanel BuildEmpty(XRayFieldsTableDisplay display)
    {
        var root = new StackPanel { Spacing = 0 };
        root.Children.Add(BuildHeader(display, interactive: false));
        root.Children.Add(new TsEmptyState
        {
            Message = display.EmptyMessage,
            Margin = new Thickness(0, 12, 0, 0),
        });
        return root;
    }

    // ── Header (web DataTable header — sortable in the data state, static chrome otherwise) ──────────
    private Border BuildHeader(XRayFieldsTableDisplay display, bool interactive)
    {
        var grid = NewColumnGrid();
        grid.Padding = new Thickness(8, 4, 8, 6);

        for (int i = 0; i < display.Columns.Count; i++)
        {
            var column = display.Columns[i];
            FrameworkElement cell = interactive
                ? BuildSortHeader(column, display)
                : BuildCaption(column);
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
    }

    private TsButton BuildSortHeader(XRayFieldsTableColumn column, XRayFieldsTableDisplay display)
    {
        bool active = string.Equals(column.Key, display.SortKey, StringComparison.Ordinal);
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = column.Header,
            IconGlyph = active ? (display.SortDescending ? SortDescendingGlyph : SortAscendingGlyph) : null,
            HorizontalAlignment = column.Numeric ? HorizontalAlignment.Right : HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(button, column.Header);
        button.Click += (_, _) => OnToggleSort(column.Key);
        return button;
    }

    private static TextBlock BuildCaption(XRayFieldsTableColumn column) => new()
    {
        Text = column.Header,
        FontSize = 11,
        FontWeight = FontWeights.SemiBold,
        Foreground = DisplayTokens.TextMuted,
        CharacterSpacing = 40,
        TextTrimming = TextTrimming.CharacterEllipsis,
        TextWrapping = TextWrapping.NoWrap,
        HorizontalAlignment = column.Numeric ? HorizontalAlignment.Right : HorizontalAlignment.Left,
    };

    // ── Row (web: mono field, right-aligned fmtInt samples, relative last seen, neutral kind badge) ──
    private static Border BuildRow(XRayFieldsTableRow row)
    {
        var grid = NewColumnGrid();
        grid.Padding = new Thickness(8, 6, 8, 6);
        grid.MinHeight = 40;

        var field = new TextBlock
        {
            Text = row.Field,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(field, 0);
        grid.Children.Add(field);

        var samples = new TextBlock
        {
            Text = row.SamplesText,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(samples, 1);
        grid.Children.Add(samples);

        var lastSeen = new TextBlock
        {
            Text = row.LastSeenText,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(lastSeen, 2);
        grid.Children.Add(lastSeen);

        var kind = new TsBadge
        {
            Status = row.KindStatus,
            Content = new TextBlock { Text = row.KindText, FontSize = 11 },
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(kind, 3);
        grid.Children.Add(kind);

        var border = new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        AutomationProperties.SetName(border, row.AutomationName);
        AutomationProperties.SetAccessibilityView(border, AccessibilityView.Content);
        return border;
    }

    private TsPagination BuildPager(int total)
    {
        var pager = new TsPagination
        {
            PageSize = XRayFieldsTableProjection.PageSize,
            TotalItems = total,
            Page = _pager.Page,
            FirstLabel = _localizer.GetString("common.pagination.first", "First page"),
            PreviousLabel = _localizer.GetString("common.pagination.previous", "Previous page"),
            NextLabel = _localizer.GetString("common.pagination.next", "Next page"),
            LastLabel = _localizer.GetString("common.pagination.last", "Last page"),
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 8, 0, 0),
        };
        pager.PageChanged += (_, page) =>
        {
            _pager.Page = page;
            Render();
        };
        return pager;
    }

    private static Grid NewColumnGrid()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SamplesColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(LastSeenColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(KindColumnWidth) });
        return grid;
    }

    // Honour the system reduced-motion preference (web parity for the prefers-reduced-motion skeleton).
    private static bool ReduceMotion()
    {
        try
        {
            return !new Windows.UI.ViewManagement.UISettings().AnimationsEnabled;
        }
        catch (Exception)
        {
            return false;
        }
    }
}
