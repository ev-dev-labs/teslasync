using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 HTTP Status surface — a parity port of
/// web/src/features/admin/components/devtools/tools/HttpStatusTool.tsx. It reproduces the web's searchable
/// HTTP status code reference: a shared <see cref="ToolCard"/> (the native mapping of the web <c>ToolCard</c> —
/// a tokenized glass panel with the amber-tinted <c>Network</c> glyph, the localized title and description)
/// wraps a search field and a three-column table. The search field filters the nineteen-code catalog by code,
/// reason phrase or description (web <c>filtered = useMemo(…)</c>); each matching row renders the code as a
/// semantic <see cref="TsBadge"/> tinted by its class (2xx success, 3xx info, 4xx warning, 5xx danger — the
/// web <c>&lt;Badge variant=…&gt;</c>), the reason phrase, and the description. When the search matches nothing
/// a friendly <see cref="TsEmptyState"/> renders, never a blank panel (the web <c>DataTable</c>
/// <c>emptyMessage</c> branch). The surface is presentational: it has no data source and no asynchronous
/// reads, so it renders the table directly (the web's single visual state). All projection flows through the
/// shared <see cref="HttpStatusToolViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade, the search field and every row carry a Narrator name, and the empty surface announces
/// through a polite live region.
/// </summary>
public sealed partial class HttpStatusTool : ContentControl, IDisposable
{
    private const double CodeColumnWidth = 84;
    private const double MaxSearchWidth = 420; // web max-w-md search field

    private readonly HttpStatusToolViewModel _viewModel;
    private readonly HttpStatusToolDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsInput _search = new();
    private readonly Border _tableHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its code source, localizer and optional diagnostics collector.</summary>
    /// <param name="source">The HTTP status code catalog (the canonical reference table).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public HttpStatusTool(
        IHttpStatusCodeSource source,
        ILocalizer localizer,
        HttpStatusToolDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new HttpStatusToolDiagnostics();
        _viewModel = new HttpStatusToolViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>HttpStatusTool</c>).</summary>
    public static string Slug => HttpStatusToolRegistration.Slug;

    /// <summary>
    /// Convenience factory that wires the canonical <see cref="HttpStatusCodeSource"/> (the web
    /// <c>HTTP_CODES</c> catalog) over the host's localizer.
    /// </summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public static HttpStatusTool Create(ILocalizer localizer, HttpStatusToolDiagnostics? diagnostics = null) =>
        new(new HttpStatusCodeSource(), localizer, diagnostics);

    private void BuildChrome()
    {
        _search.Hint = _viewModel.SearchHint;
        _search.MaxWidth = MaxSearchWidth;
        _search.HorizontalAlignment = HorizontalAlignment.Stretch;
        AutomationProperties.SetName(_search, _viewModel.SearchHint);
        _search.TextChanged += OnSearchTextChanged;

        _tableHost.HorizontalAlignment = HorizontalAlignment.Stretch;

        var body = new StackPanel { Spacing = 12 }; // web space-y-3
        body.Children.Add(_search);
        body.Children.Add(_tableHost);

        var card = new ToolCard
        {
            IconGlyph = HttpStatusToolRegistration.Glyph,
            Accent = HttpStatusToolRegistration.AccentColor,
            Title = _viewModel.Title,
            Description = _viewModel.Description,
            Body = body,
        };

        Content = card;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and the search field (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _search.TextChanged -= OnSearchTextChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e) =>
        _viewModel.SearchText = _search.Text;

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(HttpStatusToolViewModel.Display) or nameof(HttpStatusToolViewModel.State))
        {
            ScheduleRender();
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render() =>
        _tableHost.Child = _viewModel.State == HttpStatusToolState.Empty ? BuildEmpty() : BuildTable();

    private StackPanel BuildTable()
    {
        var table = new StackPanel { Spacing = 0 };
        table.Children.Add(BuildHeader());

        foreach (var row in _viewModel.Display.Rows)
        {
            table.Children.Add(BuildRow(row));
        }

        AutomationProperties.SetName(table, _viewModel.Title);
        return table;
    }

    private Border BuildHeader()
    {
        var grid = NewRowGrid();
        grid.Padding = new Thickness(8, 4, 8, 6);

        AddHeaderCell(grid, 0, _viewModel.StatusCodeHeader);
        AddHeaderCell(grid, 1, _viewModel.StatusTextHeader);
        AddHeaderCell(grid, 2, _viewModel.StatusDescHeader);

        var border = new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        AutomationProperties.SetAccessibilityView(border, AccessibilityView.Raw);
        return border;
    }

    private static void AddHeaderCell(Grid grid, int column, string text)
    {
        var caption = new TextBlock
        {
            Text = text,
            FontSize = 11,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 40,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(caption, column);
        grid.Children.Add(caption);
    }

    private static Border BuildRow(HttpStatusCodeRow row)
    {
        var grid = NewRowGrid();
        grid.Padding = new Thickness(8, 6, 8, 6);
        grid.MinHeight = 36; // web compact density

        var badge = new TsBadge
        {
            Status = row.Status,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
            Content = new TextBlock
            {
                Text = row.CodeText,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
            },
        };
        Grid.SetColumn(badge, 0);
        grid.Children.Add(badge);

        var text = new TextBlock
        {
            Text = row.Text,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(text, 1);
        grid.Children.Add(text);

        var description = new TextBlock
        {
            Text = row.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(description, 2);
        grid.Children.Add(description);

        var border = new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private TsEmptyState BuildEmpty()
    {
        var empty = new TsEmptyState
        {
            Message = _viewModel.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        LiveRegion.Configure(empty);
        LiveRegion.Announce(empty);
        return empty;
    }

    private static Grid NewRowGrid()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(CodeColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.4, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        return grid;
    }
}
