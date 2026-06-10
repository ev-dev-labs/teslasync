using System.Globalization;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SecurityAccess;

/// <summary>
/// The native WinUI 3 <c>EventHistoryTable</c> feature surface — a parity port of
/// <c>web/src/features/admin/components/security-access/EventHistoryTable.tsx</c>. It is a pure presentational
/// control: assign a <see cref="Model"/> (the web <c>history</c> + <c>isLoading</c> props) and it renders one
/// of three branches inside a <see cref="TsGlassPanel"/> titled "Security Event History" — the eight-line
/// loading skeleton (web <c>&lt;Skeleton lines={8}/&gt;</c>), the friendly empty surface (web <c>DataTable</c>
/// <c>emptyMessage</c>), or the sorted, paged event table. The web table renders a <c>Badge</c> for the lock
/// and sentry columns and colour-coded text for the door and window columns, so (unlike the text-only shared
/// <c>TsDataTable</c>) this view composes the table from the same shared primitives
/// (<see cref="TsBadge"/>, <see cref="TsDateTime"/>, <see cref="TsPagination"/>, <see cref="TsSelect"/>) driven
/// by the WinUI-free <see cref="EventHistoryTableProjection"/>. The sortable time header and the
/// 50-row pagination mirror the web source. Every string resolves through the i18n facade and every
/// interactive element carries a Narrator name.
/// </summary>
public sealed partial class EventHistoryTable : ContentControl
{
    private const string SortAscendingGlyph = "\uE70E";
    private const string SortDescendingGlyph = "\uE70D";
    private const int SkeletonLineCount = 8;

    private static readonly GridLength[] ColumnWidths =
    {
        new(188), // time
        new(116), // lock
        new(116), // sentry
        new(160), // doors
        new(160), // windows
    };

    private readonly ILocalizer _localizer;
    private readonly EventHistoryTableDiagnostics _diagnostics;
    private readonly TableSortState _sort = new();

    private EventHistoryTableModel _model;
    private int _page = 1;
    private int _pageSize = EventHistoryTableProjection.DefaultPageSize;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="EventHistoryTableModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public EventHistoryTable(
        ILocalizer localizer,
        EventHistoryTableModel? model = null,
        EventHistoryTableDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? EventHistoryTableModel.Empty;
        _diagnostics = diagnostics ?? new EventHistoryTableDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>EventHistoryTable</c>).</summary>
    public static string Slug => EventHistoryTableRegistration.Slug;

    /// <summary>The render model (the web <c>history</c> + <c>isLoading</c> props); reassigning re-renders from page one.</summary>
    public EventHistoryTableModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            _page = 1;
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

    private void Render()
    {
        var display = EventHistoryTableProjection.Project(_model, _localizer, _sort, _page, _pageSize);
        _page = display.Page; // adopt the clamped page

        var content = new StackPanel { Spacing = 16 };
        content.Children.Add(new SectionTitle { Value = display.Title });
        content.Children.Add(BuildStateSurface(display));

        AutomationProperties.SetName(this, display.AutomationName);
        Content = new TsFadeIn
        {
            DelayMs = 300,
            Content = new TsGlassPanel { Padding = new Thickness(16), Content = content },
        };
    }

    private FrameworkElement BuildStateSurface(EventHistoryTableDisplay display) => display.State switch
    {
        EventHistoryTableState.Loading => BuildLoading(),
        EventHistoryTableState.Empty => new TsEmptyState { Message = display.EmptyMessage },
        _ => BuildData(display),
    };

    private static StackPanel BuildLoading()
    {
        var stack = new StackPanel { Spacing = 10 };
        for (int i = 0; i < SkeletonLineCount; i++)
        {
            stack.Children.Add(new TsSkeleton { BlockHeight = 14 });
        }

        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        return stack;
    }

    private StackPanel BuildData(EventHistoryTableDisplay display)
    {
        var table = new StackPanel { Spacing = 0 };
        table.Children.Add(BuildHeader(display));
        foreach (var row in display.Rows)
        {
            table.Children.Add(BuildRow(row));
        }

        var scroller = new ScrollViewer
        {
            Content = table,
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        var root = new StackPanel { Spacing = 12 };
        root.Children.Add(scroller);
        if (display.ShowPagination)
        {
            root.Children.Add(BuildFooter(display));
        }

        return root;
    }

    private Border BuildHeader(EventHistoryTableDisplay display)
    {
        var grid = NewRowGrid();
        for (int i = 0; i < display.Columns.Count; i++)
        {
            var column = display.Columns[i];
            FrameworkElement cell = column.Sortable
                ? BuildSortHeader(column, display.TimeSortDirection)
                : HeaderText(column.Header);
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 0, 0, 8),
        };
    }

    private TsButton BuildSortHeader(EventHistoryColumn column, SortDirection direction)
    {
        string? glyph = direction switch
        {
            SortDirection.Ascending => SortAscendingGlyph,
            SortDirection.Descending => SortDescendingGlyph,
            _ => null,
        };

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = column.Header,
            IconGlyph = glyph,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(button, HeaderAutomationName(column.Header, direction));
        button.Click += (_, _) =>
        {
            _sort.Toggle(EventHistoryTableProjection.TimeColumnKey);
            _page = 1;
            Render();
        };
        return button;
    }

    private string HeaderAutomationName(string header, SortDirection direction)
    {
        string suffix = direction switch
        {
            SortDirection.Ascending => _localizer.GetString("a11y.sortedAscending", "sorted ascending"),
            SortDirection.Descending => _localizer.GetString("a11y.sortedDescending", "sorted descending"),
            _ => _localizer.GetString("a11y.sortableColumn", "sortable"),
        };
        return string.Create(CultureInfo.CurrentCulture, $"{header}, {suffix}");
    }

    private static Border BuildRow(EventHistoryRowView row)
    {
        var grid = NewRowGrid();

        var time = new TsDateTime
        {
            Value = row.CreatedAt,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(time, 0);
        grid.Children.Add(time);

        var lockBadge = BuildBadge(row.LockStatus, row.LockText);
        Grid.SetColumn(lockBadge, 1);
        grid.Children.Add(lockBadge);

        var sentryBadge = BuildBadge(row.SentryStatus, row.SentryText);
        Grid.SetColumn(sentryBadge, 2);
        grid.Children.Add(sentryBadge);

        var doors = StatusText(row.DoorsText, row.DoorsClosed);
        Grid.SetColumn(doors, 3);
        grid.Children.Add(doors);

        var windows = StatusText(row.WindowsText, row.WindowsClosed);
        Grid.SetColumn(windows, 4);
        grid.Children.Add(windows);

        AutomationProperties.SetName(grid, row.AutomationName);
        AutomationProperties.SetAccessibilityView(grid, AccessibilityView.Content);

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 8, 0, 8),
        };
    }

    private static TsBadge BuildBadge(StatusKind status, string text)
    {
        var badge = new TsBadge
        {
            Status = status,
            Content = new TextBlock
            {
                Text = text,
                FontSize = 12,
                FontFamily = TypographyTokens.Sans,
            },
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private static TextBlock StatusText(string text, bool closed) => new()
    {
        Text = text,
        FontSize = 13,
        FontFamily = TypographyTokens.Sans,
        Foreground = StatusBrush(closed ? StatusKind.Success : StatusKind.Warning),
        TextTrimming = TextTrimming.CharacterEllipsis,
        VerticalAlignment = VerticalAlignment.Center,
        Padding = new Thickness(8, 0, 8, 0),
    };

    private Grid BuildFooter(EventHistoryTableDisplay display)
    {
        var footer = new Grid { Margin = new Thickness(0, 4, 0, 0) };
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var sizer = BuildPageSizeSelector(display);
        Grid.SetColumn(sizer, 0);
        footer.Children.Add(sizer);

        var pager = BuildPager(display);
        Grid.SetColumn(pager, 1);
        footer.Children.Add(pager);

        return footer;
    }

    private StackPanel BuildPageSizeSelector(EventHistoryTableDisplay display)
    {
        var label = new TextBlock
        {
            Text = display.PageSizeLabel,
            FontFamily = TypographyTokens.Sans,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var select = new TsSelect { MinWidth = 88, VerticalAlignment = VerticalAlignment.Center };
        int selectedIndex = 0;
        for (int i = 0; i < display.PageSizeOptions.Count; i++)
        {
            int size = display.PageSizeOptions[i];
            select.Items.Add(new ComboBoxItem
            {
                Content = size.ToString(CultureInfo.CurrentCulture),
                Tag = size,
            });
            if (size == display.PageSize)
            {
                selectedIndex = i;
            }
        }

        select.SelectedIndex = selectedIndex;
        AutomationProperties.SetName(select, display.PageSizeLabel);
        select.SelectionChanged += (_, _) =>
        {
            if (select.SelectedItem is ComboBoxItem { Tag: int size })
            {
                _pageSize = size;
                _page = 1;
                Render();
            }
        };

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(label);
        row.Children.Add(select);
        return row;
    }

    private TsPagination BuildPager(EventHistoryTableDisplay display)
    {
        var pager = new TsPagination
        {
            Page = display.Page,
            PageSize = display.PageSize,
            TotalItems = display.TotalCount,
            FirstLabel = display.FirstLabel,
            PreviousLabel = display.PreviousLabel,
            NextLabel = display.NextLabel,
            LastLabel = display.LastLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        pager.PageChanged += (_, page) =>
        {
            _page = page;
            Render();
        };
        return pager;
    }

    private static Grid NewRowGrid()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        foreach (var width in ColumnWidths)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = width });
        }

        return grid;
    }

    private static TextBlock HeaderText(string text) => new()
    {
        Text = text,
        FontFamily = TypographyTokens.Sans,
        FontSize = 12,
        FontWeight = FontWeights.Medium,
        Foreground = DisplayTokens.TextSecondary,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Brush StatusBrush(StatusKind kind) =>
        DisplayTokens.Brush(StatusResources.AccentBrushKey(kind));

    protected override AutomationPeer OnCreateAutomationPeer() => new EventHistoryTableAutomationPeer(this);

    private sealed class EventHistoryTableAutomationPeer(EventHistoryTable owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.DataGrid;
    }
}
