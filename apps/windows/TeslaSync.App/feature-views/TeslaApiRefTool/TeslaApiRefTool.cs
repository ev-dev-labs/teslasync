using System.Globalization;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using DisplayTokens = TeslaSync.App.Components.DataDisplay.DisplayTokens;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Tesla Fleet API reference tool — a parity port of
/// web/src/features/admin/components/devtools/tools/TeslaApiRefTool.tsx. It reproduces the web
/// <c>ToolCard</c> chrome (cyan "Library" icon chip + title + description) wrapping the tool body: a
/// search field with a leading glyph and a paged reference table whose three columns mirror the web
/// <c>DataTable</c> — an info/warning method <see cref="TsBadge"/>, a monospaced request path with a
/// <see cref="TsCopyButton"/>, and the endpoint description. The endpoint data is a static catalog
/// (the tool performs no I/O), so the only dynamic state is the filtered/empty split: all filtering
/// flows through the shared <see cref="TeslaApiRefToolViewModel"/> + <see cref="TeslaApiRefFilter"/>.
/// Every string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class TeslaApiRefTool : ContentControl, IDisposable
{
    private const string SearchGlyph = "\uE721"; // Segoe Fluent — Search (empty-state magnifier)

    private static readonly FontFamily MonoFont = new("Consolas");

    private readonly TeslaApiRefToolViewModel _viewModel;
    private readonly TeslaApiRefToolDiagnostics _diagnostics;

    private readonly TsInput _search = new();
    private readonly Border _headerRow = new();
    private readonly StackPanel _rowsHost = new() { Spacing = 0 };
    private readonly TsEmptyState _empty = new();
    private readonly TsPagination _pager = new();

    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over its localizer and (optional) PII-safe diagnostics sink.</summary>
    public TeslaApiRefTool(ILocalizer localizer, TeslaApiRefToolDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TeslaApiRefToolViewModel(localizer);
        _diagnostics = diagnostics ?? new TeslaApiRefToolDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _search.TextChanged += OnSearchChanged;
        _pager.PageChanged += OnPageChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface id this view registers under (<c>tesla-api</c>).</summary>
    public static string RegistryId => TeslaApiRefToolRegistration.Id;

    /// <summary>The diagnostics surface slug this view registers under (<c>TeslaApiRefTool</c>).</summary>
    public static string Slug => TeslaApiRefToolRegistration.Slug;

    private ToolCard BuildChrome() => new()
    {
        IconGlyph = TeslaApiRefToolRegistration.IconGlyph,
        Accent = TeslaApiRefToolRegistration.Accent,
        Title = _viewModel.Title,
        Description = _viewModel.Description,
        Body = BuildBody(),
    };

    private StackPanel BuildBody()
    {
        _pager.FirstLabel = _viewModel.FirstPageLabel;
        _pager.PreviousLabel = _viewModel.PreviousPageLabel;
        _pager.NextLabel = _viewModel.NextPageLabel;
        _pager.LastLabel = _viewModel.LastPageLabel;
        AutomationProperties.SetName(_pager, _viewModel.PaginationAccessibleName);

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(BuildSearch());
        body.Children.Add(BuildTable());
        body.Children.Add(_pager);
        return body;
    }

    private Grid BuildSearch()
    {
        _search.Hint = _viewModel.SearchHint;
        _search.Padding = new Thickness(36, 8, 12, 8); // leave room for the leading glyph
        AutomationProperties.SetName(_search, _viewModel.SearchAccessibleName);

        var glyph = new FontIcon
        {
            Glyph = TeslaApiRefToolRegistration.IconGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(12, 0, 0, 0),
            IsHitTestVisible = false,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        var grid = new Grid();
        grid.Children.Add(_search);
        grid.Children.Add(glyph);
        return grid;
    }

    private Border BuildTable()
    {
        BuildHeaderRow();

        _empty.IconGlyph = SearchGlyph;
        _empty.Title = _viewModel.EmptyTitle;
        _empty.Message = _viewModel.EmptyMessage;
        _empty.Visibility = Visibility.Collapsed;
        _empty.Padding = new Thickness(0, 24, 0, 24);

        var content = new StackPanel { Spacing = 0 };
        content.Children.Add(_headerRow);
        content.Children.Add(_rowsHost);
        content.Children.Add(_empty);

        var host = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 10),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(4),
            Child = content,
        };
        AutomationProperties.SetName(host, _viewModel.TableAccessibleName);
        return host;
    }

    private void BuildHeaderRow()
    {
        var grid = NewColumnGrid();
        grid.Padding = new Thickness(10, 6, 10, 8);
        grid.Children.Add(HeaderCaption(_viewModel.MethodHeader, 0));
        grid.Children.Add(HeaderCaption(_viewModel.PathHeader, 1));
        grid.Children.Add(HeaderCaption(_viewModel.DescriptionHeader, 2));

        _headerRow.Child = grid;
        _headerRow.BorderBrush = DisplayTokens.Border;
        _headerRow.BorderThickness = new Thickness(0, 0, 0, 1);
        AutomationProperties.SetAccessibilityView(_headerRow, AccessibilityView.Raw);
    }

    private static TextBlock HeaderCaption(string text, int column)
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
        return caption;
    }

    private Border BuildRow(TeslaApiEndpoint endpoint)
    {
        var grid = NewColumnGrid();
        grid.Padding = new Thickness(10, 6, 10, 6);
        grid.MinHeight = 36;

        var badge = new TsBadge
        {
            Status = endpoint.MethodStatus,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
            Content = new TextBlock { Text = endpoint.Method, FontSize = 11, FontWeight = FontWeights.SemiBold },
        };
        AutomationProperties.SetName(badge, endpoint.Method);
        Grid.SetColumn(badge, 0);

        var path = new TextBlock
        {
            Text = endpoint.Path,
            FontFamily = MonoFont,
            FontSize = 12,
            Foreground = DisplayTokens.Accent,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
            IsTextSelectionEnabled = true,
        };
        var copy = new TsCopyButton
        {
            ValueToCopy = endpoint.Path,
            CopyLabel = _viewModel.CopyLabel,
            CopiedLabel = _viewModel.CopiedLabel,
            Text = _viewModel.CopyLabel,
            Size = ControlSize.Small,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(copy, _viewModel.CopyAccessibleName(endpoint.Path));

        var pathCell = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        pathCell.Children.Add(path);
        pathCell.Children.Add(copy);
        Grid.SetColumn(pathCell, 1);

        var description = new TextBlock
        {
            Text = endpoint.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(description, 2);

        grid.Children.Add(badge);
        grid.Children.Add(pathCell);
        grid.Children.Add(description);

        var row = new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        AutomationProperties.SetName(
            row,
            string.Format(CultureInfo.CurrentCulture, "{0} {1}. {2}", endpoint.Method, endpoint.Path, endpoint.Description));
        return row;
    }

    private static Grid NewColumnGrid()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(90) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(3, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        return grid;
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

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnSearchChanged(object sender, TextChangedEventArgs e) => _viewModel.Search = _search.Text;

    private void OnPageChanged(object? sender, int page) => _viewModel.Page = page;

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(TeslaApiRefToolViewModel.PageItems))
        {
            Render();
        }
    }

    private void Render()
    {
        _rowsHost.Children.Clear();
        foreach (var endpoint in _viewModel.PageItems)
        {
            _rowsHost.Children.Add(BuildRow(endpoint));
        }

        bool empty = _viewModel.IsEmpty;
        _headerRow.Visibility = empty ? Visibility.Collapsed : Visibility.Visible;
        _rowsHost.Visibility = empty ? Visibility.Collapsed : Visibility.Visible;
        _empty.Visibility = empty ? Visibility.Visible : Visibility.Collapsed;

        _pager.PageSize = TeslaApiRefToolViewModel.PageSize;
        _pager.TotalItems = _viewModel.TotalItems;
        _pager.Page = _viewModel.Page;
        _pager.Visibility = _viewModel.ShowPagination ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>Detach from the view-model and input handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _search.TextChanged -= OnSearchChanged;
        _pager.PageChanged -= OnPageChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }
}
