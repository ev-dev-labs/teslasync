using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;

namespace TeslaSync.App.Components.Layout;

/// <summary>Stack orientation for <see cref="TsStack"/>.</summary>
public enum StackDirection
{
    /// <summary>Children flow top-to-bottom.</summary>
    Vertical,

    /// <summary>Children flow left-to-right.</summary>
    Horizontal,
}

/// <summary>
/// A spacing-tokenized stack (port of the web <c>Stack</c>). Thin wrapper over a
/// <see cref="StackPanel"/> that exposes <see cref="Direction"/> and
/// <see cref="Spacing"/> and accepts arbitrary children via <see cref="Children"/>.
/// </summary>
[System.Diagnostics.CodeAnalysis.SuppressMessage(
    "Naming",
    "CA1711:Identifiers should not have incorrect suffix",
    Justification = "Component name mirrors the web Stack primitive it ports (P2/W2-0005 spec).")]
public partial class TsStack : ContentControl
{
    private readonly StackPanel _panel = new() { Spacing = 12 };

    public static readonly DependencyProperty DirectionProperty = DependencyProperty.Register(
        nameof(Direction), typeof(StackDirection), typeof(TsStack),
        new PropertyMetadata(StackDirection.Vertical, OnDirectionChanged));

    public static readonly DependencyProperty SpacingProperty = DependencyProperty.Register(
        nameof(Spacing), typeof(double), typeof(TsStack),
        new PropertyMetadata(12.0, OnSpacingChanged));

    public TsStack()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Content = _panel;
    }

    /// <summary>Layout direction.</summary>
    public StackDirection Direction
    {
        get => (StackDirection)GetValue(DirectionProperty);
        set => SetValue(DirectionProperty, value);
    }

    /// <summary>Gap between children, in pixels.</summary>
    public double Spacing
    {
        get => (double)GetValue(SpacingProperty);
        set => SetValue(SpacingProperty, value);
    }

    /// <summary>The stacked children.</summary>
    public IList<UIElement> Children => _panel.Children;

    private static void OnDirectionChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStack)d)._panel.Orientation =
            (StackDirection)e.NewValue == StackDirection.Horizontal ? Orientation.Horizontal : Orientation.Vertical;

    private static void OnSpacingChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStack)d)._panel.Spacing = (double)e.NewValue;
}

/// <summary>
/// A responsive uniform grid (port of the web <c>Grid</c>). Lays children out in a
/// fixed number of equal columns that wrap to new rows, with tokenized gutters.
/// </summary>
public partial class TsGrid : ContentControl
{
    private readonly VariableSizedWrapGrid _grid = new()
    {
        Orientation = Orientation.Horizontal,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    public static readonly DependencyProperty ColumnsProperty = DependencyProperty.Register(
        nameof(Columns), typeof(int), typeof(TsGrid), new PropertyMetadata(2, OnLayoutChanged));

    public static readonly DependencyProperty GutterProperty = DependencyProperty.Register(
        nameof(Gutter), typeof(double), typeof(TsGrid), new PropertyMetadata(16.0, OnLayoutChanged));

    public static readonly DependencyProperty ItemMinWidthProperty = DependencyProperty.Register(
        nameof(ItemMinWidth), typeof(double), typeof(TsGrid), new PropertyMetadata(240.0, OnLayoutChanged));

    public TsGrid()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Content = _grid;
        SizeChanged += (_, _) => ApplyLayout();
    }

    /// <summary>Maximum number of columns at full width.</summary>
    public int Columns
    {
        get => (int)GetValue(ColumnsProperty);
        set => SetValue(ColumnsProperty, value);
    }

    /// <summary>Gap between cells, in pixels.</summary>
    public double Gutter
    {
        get => (double)GetValue(GutterProperty);
        set => SetValue(GutterProperty, value);
    }

    /// <summary>Minimum cell width before the column count is reduced.</summary>
    public double ItemMinWidth
    {
        get => (double)GetValue(ItemMinWidthProperty);
        set => SetValue(ItemMinWidthProperty, value);
    }

    /// <summary>The grid cells.</summary>
    public IList<UIElement> Children => _grid.Children;

    private static void OnLayoutChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsGrid)d).ApplyLayout();

    private void ApplyLayout()
    {
        double available = ActualWidth > 0 ? ActualWidth : double.NaN;
        int columns = Columns;
        if (!double.IsNaN(available) && ItemMinWidth > 0)
        {
            int fit = Math.Max(1, (int)Math.Floor((available + Gutter) / (ItemMinWidth + Gutter)));
            columns = Math.Clamp(fit, 1, Columns);
        }

        double cellWidth = double.IsNaN(available)
            ? ItemMinWidth
            : Math.Max(1, (available - (Gutter * (columns - 1))) / columns);

        _grid.MaximumRowsOrColumns = columns;
        _grid.ItemWidth = cellWidth;
        _grid.ItemHeight = double.NaN;

        foreach (var child in _grid.Children)
        {
            if (child is FrameworkElement fe)
            {
                fe.Margin = new Thickness(0, 0, Gutter, Gutter);
                fe.Width = cellWidth;
            }
        }
    }
}

/// <summary>
/// Page-level scaffold (port of the web <c>PageContainer</c>). Renders an optional
/// <see cref="Title"/>/<see cref="Subtitle"/> header above the page body and shows a
/// centred spinner while <see cref="IsLoading"/>, an error surface on
/// <see cref="ErrorMessage"/>, otherwise the content. Content is never hidden behind
/// a single null gate — only the explicit loading/error states replace it.
/// </summary>
public partial class TsPageContainer : ContentControl
{
    private readonly Grid _root = new();
    private readonly StackPanel _column = new() { Spacing = 20 };
    private readonly TsPageHeader _header = new();
    private readonly ContentPresenter _body = new();
    private readonly TsSpinner _spinner = new() { Visibility = Visibility.Collapsed };
    private readonly TsErrorDisplay _error = new() { Visibility = Visibility.Collapsed };
    private object? _pageContent;

    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(TsPageContainer),
        new PropertyMetadata(string.Empty, OnHeaderChanged));

    public static readonly DependencyProperty SubtitleProperty = DependencyProperty.Register(
        nameof(Subtitle), typeof(string), typeof(TsPageContainer),
        new PropertyMetadata(string.Empty, OnHeaderChanged));

    public static readonly DependencyProperty IsLoadingProperty = DependencyProperty.Register(
        nameof(IsLoading), typeof(bool), typeof(TsPageContainer),
        new PropertyMetadata(false, OnStateChanged));

    public static readonly DependencyProperty ErrorMessageProperty = DependencyProperty.Register(
        nameof(ErrorMessage), typeof(string), typeof(TsPageContainer),
        new PropertyMetadata(null, OnStateChanged));

    public static readonly DependencyProperty PageContentProperty = DependencyProperty.Register(
        nameof(PageContent), typeof(object), typeof(TsPageContainer),
        new PropertyMetadata(null, OnPageContentChanged));

    public TsPageContainer()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Padding = new Thickness(24);
        _spinner.Label = "Loading…";
        _error.ActionInvoked += (_, _) => RetryRequested?.Invoke(this, EventArgs.Empty);

        _column.Children.Add(_header);
        _column.Children.Add(_body);
        _root.Children.Add(_column);
        _root.Children.Add(_spinner);
        _root.Children.Add(_error);
        Content = _root;
        Render();
    }

    /// <summary>Raised when the user retries after an error.</summary>
    public event EventHandler? RetryRequested;

    /// <summary>Localized page title.</summary>
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    /// <summary>Localized page subtitle.</summary>
    public string Subtitle
    {
        get => (string)GetValue(SubtitleProperty);
        set => SetValue(SubtitleProperty, value);
    }

    /// <summary>When true a centred spinner replaces the body.</summary>
    public bool IsLoading
    {
        get => (bool)GetValue(IsLoadingProperty);
        set => SetValue(IsLoadingProperty, value);
    }

    /// <summary>When set, an error surface replaces the body.</summary>
    public string? ErrorMessage
    {
        get => (string?)GetValue(ErrorMessageProperty);
        set => SetValue(ErrorMessageProperty, value);
    }

    /// <summary>The page body content.</summary>
    public object? PageContent
    {
        get => GetValue(PageContentProperty);
        set => SetValue(PageContentProperty, value);
    }

    /// <summary>Add an action element to the header's action row.</summary>
    public void AddHeaderAction(UIElement action) => _header.AddAction(action);

    private static void OnHeaderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var page = (TsPageContainer)d;
        page._header.Title = page.Title;
        page._header.Subtitle = page.Subtitle;
    }

    private static void OnStateChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsPageContainer)d).Render();

    private static void OnPageContentChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var page = (TsPageContainer)d;
        page._pageContent = e.NewValue;
        page.Render();
    }

    private void Render()
    {
        bool hasError = !string.IsNullOrEmpty(ErrorMessage);
        _error.Message = ErrorMessage ?? string.Empty;

        _spinner.Visibility = IsLoading ? Visibility.Visible : Visibility.Collapsed;
        _error.Visibility = !IsLoading && hasError ? Visibility.Visible : Visibility.Collapsed;
        _column.Visibility = IsLoading ? Visibility.Collapsed : Visibility.Visible;
        _body.Content = _pageContent;
        _body.Visibility = !IsLoading && !hasError ? Visibility.Visible : Visibility.Collapsed;
    }
}

/// <summary>
/// Page header with a title, optional subtitle and a right-aligned actions row
/// (port of the web <c>PageHeader</c>).
/// </summary>
public partial class TsPageHeader : ContentControl
{
    private readonly Grid _root = new();
    private readonly StackPanel _titleColumn = new() { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(TsPageHeader),
        new PropertyMetadata(string.Empty, OnTitleChanged));

    public static readonly DependencyProperty SubtitleProperty = DependencyProperty.Register(
        nameof(Subtitle), typeof(string), typeof(TsPageHeader),
        new PropertyMetadata(string.Empty, OnSubtitleChanged));

    public TsPageHeader()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        _subtitle.Visibility = Visibility.Collapsed;

        _titleColumn.Children.Add(_title);
        _titleColumn.Children.Add(_subtitle);

        _root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _root.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleColumn, 0);
        Grid.SetColumn(_actions, 1);
        _root.Children.Add(_titleColumn);
        _root.Children.Add(_actions);
        Content = _root;

        AutomationProperties.SetHeadingLevel(_title, AutomationHeadingLevel.Level1);
    }

    /// <summary>Localized title text.</summary>
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    /// <summary>Localized subtitle text (hidden when empty).</summary>
    public string Subtitle
    {
        get => (string)GetValue(SubtitleProperty);
        set => SetValue(SubtitleProperty, value);
    }

    /// <summary>Add a trailing action element (e.g. a button).</summary>
    public void AddAction(UIElement action)
    {
        ArgumentNullException.ThrowIfNull(action);
        _actions.Children.Add(action);
    }

    private static void OnTitleChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var header = (TsPageHeader)d;
        header._title.Value = (string)e.NewValue;
        AutomationProperties.SetName(header, (string)e.NewValue);
    }

    private static void OnSubtitleChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var header = (TsPageHeader)d;
        string text = (string)e.NewValue;
        header._subtitle.Value = text;
        header._subtitle.Visibility = string.IsNullOrEmpty(text) ? Visibility.Collapsed : Visibility.Visible;
    }
}

/// <summary>
/// Sticky page header (port of the web <c>PageHeaderSticky</c>). A
/// <see cref="TsPageHeader"/> on a tokenized glass surface intended to be pinned at
/// the top of a scrolling page; the host places it in the non-scrolling region.
/// </summary>
public partial class TsPageHeaderSticky : ContentControl
{
    private readonly TsPageHeader _header = new();

    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(TsPageHeaderSticky),
        new PropertyMetadata(string.Empty, OnTitleChanged));

    public static readonly DependencyProperty SubtitleProperty = DependencyProperty.Register(
        nameof(Subtitle), typeof(string), typeof(TsPageHeaderSticky),
        new PropertyMetadata(string.Empty, OnSubtitleChanged));

    public TsPageHeaderSticky()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        var surface = new TsGlassPanel { Content = _header, Padding = new Thickness(20, 14, 20, 14) };
        Content = surface;
    }

    /// <summary>Localized title text.</summary>
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    /// <summary>Localized subtitle text.</summary>
    public string Subtitle
    {
        get => (string)GetValue(SubtitleProperty);
        set => SetValue(SubtitleProperty, value);
    }

    /// <summary>Add a trailing action element.</summary>
    public void AddAction(UIElement action) => _header.AddAction(action);

    private static void OnTitleChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsPageHeaderSticky)d)._header.Title = (string)e.NewValue;

    private static void OnSubtitleChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsPageHeaderSticky)d)._header.Subtitle = (string)e.NewValue;
}
