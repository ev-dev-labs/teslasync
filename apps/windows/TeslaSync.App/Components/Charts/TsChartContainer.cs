using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Framing surface for every chart (mirrors the web <c>ChartContainer</c>). Wraps
/// a chart <see cref="Body"/> in a tokenized glass panel with a title / subtitle,
/// an <see cref="Actions"/> slot (export menu, metric switcher, …) and four
/// mutually exclusive bodies driven by <see cref="State"/>: loading, empty, error
/// and ready. An <see cref="AccessibleSummary"/> is published to UI Automation so
/// the chart is described to assistive technology, and a built-in toggle reveals a
/// tabular <see cref="DataView"/> alternative for non-visual users.
/// </summary>
public partial class TsChartContainer : ContentControl
{
    private readonly PanelTitle _title = new();
    private readonly Caption _subtitle = new();
    private readonly ContentPresenter _actionsHost = new() { HorizontalAlignment = HorizontalAlignment.Right };
    private readonly Grid _bodyHost = new() { MinHeight = 160 };
    private readonly ContentPresenter _bodyPresenter = new();
    private readonly StackPanel _loadingBody;
    private readonly Caption _emptyBody = new() { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
    private readonly ErrorText _errorBody = new() { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
    private readonly ToggleButton _dataToggle = new();
    private readonly TsChartDataView _dataView = new() { Visibility = Visibility.Collapsed };

    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(TsChartContainer),
        new PropertyMetadata(string.Empty, OnHeaderChanged));

    public static readonly DependencyProperty SubtitleProperty = DependencyProperty.Register(
        nameof(Subtitle), typeof(string), typeof(TsChartContainer),
        new PropertyMetadata(string.Empty, OnHeaderChanged));

    public static readonly DependencyProperty StateProperty = DependencyProperty.Register(
        nameof(State), typeof(ChartState), typeof(TsChartContainer),
        new PropertyMetadata(ChartState.Ready, OnStateChanged));

    public static readonly DependencyProperty BodyProperty = DependencyProperty.Register(
        nameof(Body), typeof(object), typeof(TsChartContainer),
        new PropertyMetadata(null, OnBodyChanged));

    public static readonly DependencyProperty ActionsProperty = DependencyProperty.Register(
        nameof(Actions), typeof(object), typeof(TsChartContainer),
        new PropertyMetadata(null, OnActionsChanged));

    public static readonly DependencyProperty EmptyMessageProperty = DependencyProperty.Register(
        nameof(EmptyMessage), typeof(string), typeof(TsChartContainer),
        new PropertyMetadata("No data available", OnMessagesChanged));

    public static readonly DependencyProperty ErrorMessageProperty = DependencyProperty.Register(
        nameof(ErrorMessage), typeof(string), typeof(TsChartContainer),
        new PropertyMetadata("Unable to load chart", OnMessagesChanged));

    public static readonly DependencyProperty LoadingMessageProperty = DependencyProperty.Register(
        nameof(LoadingMessage), typeof(string), typeof(TsChartContainer),
        new PropertyMetadata("Loading", OnMessagesChanged));

    public static readonly DependencyProperty AccessibleSummaryProperty = DependencyProperty.Register(
        nameof(AccessibleSummary), typeof(string), typeof(TsChartContainer),
        new PropertyMetadata(string.Empty, OnSummaryChanged));

    public static readonly DependencyProperty DataViewLabelProperty = DependencyProperty.Register(
        nameof(DataViewLabel), typeof(string), typeof(TsChartContainer),
        new PropertyMetadata("Show data table", OnMessagesChanged));

    public TsChartContainer()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        _subtitle.Visibility = Visibility.Collapsed;

        _loadingBody = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 8,
            Visibility = Visibility.Collapsed,
        };
        _loadingBody.Children.Add(new ProgressRing { IsActive = true, Width = 28, Height = 28 });
        var loadingCaption = new Caption { HorizontalAlignment = HorizontalAlignment.Center };
        loadingCaption.Value = "Loading";
        _loadingBody.Children.Add(loadingCaption);

        _emptyBody.Visibility = Visibility.Collapsed;
        _errorBody.Visibility = Visibility.Collapsed;

        _bodyHost.Children.Add(_bodyPresenter);
        _bodyHost.Children.Add(_loadingBody);
        _bodyHost.Children.Add(_emptyBody);
        _bodyHost.Children.Add(_errorBody);

        _dataToggle.Content = "Show data table";
        _dataToggle.Checked += (s, e) => _dataView.Visibility = Visibility.Visible;
        _dataToggle.Unchecked += (s, e) => _dataView.Visibility = Visibility.Collapsed;

        var header = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titles = new StackPanel { Spacing = 2 };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);
        Grid.SetColumn(_actionsHost, 1);
        header.Children.Add(titles);
        header.Children.Add(_actionsHost);

        var root = new StackPanel { Spacing = 4 };
        root.Children.Add(header);
        root.Children.Add(_bodyHost);
        root.Children.Add(_dataToggle);
        root.Children.Add(_dataView);

        Content = new TsGlassPanel { Content = root, Padding = new Thickness(16) };

        ApplyState();
    }

    /// <summary>Chart heading.</summary>
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    /// <summary>Optional supporting sub-heading.</summary>
    public string Subtitle
    {
        get => (string)GetValue(SubtitleProperty);
        set => SetValue(SubtitleProperty, value);
    }

    /// <summary>Which body (loading / empty / error / ready) is shown.</summary>
    public ChartState State
    {
        get => (ChartState)GetValue(StateProperty);
        set => SetValue(StateProperty, value);
    }

    /// <summary>The chart control rendered in the ready state.</summary>
    public object? Body
    {
        get => GetValue(BodyProperty);
        set => SetValue(BodyProperty, value);
    }

    /// <summary>Header action slot (export menu, metric switcher, …).</summary>
    public object? Actions
    {
        get => GetValue(ActionsProperty);
        set => SetValue(ActionsProperty, value);
    }

    /// <summary>Localized message for the empty state.</summary>
    public string EmptyMessage
    {
        get => (string)GetValue(EmptyMessageProperty);
        set => SetValue(EmptyMessageProperty, value);
    }

    /// <summary>Localized message for the error state.</summary>
    public string ErrorMessage
    {
        get => (string)GetValue(ErrorMessageProperty);
        set => SetValue(ErrorMessageProperty, value);
    }

    /// <summary>Localized message for the loading state.</summary>
    public string LoadingMessage
    {
        get => (string)GetValue(LoadingMessageProperty);
        set => SetValue(LoadingMessageProperty, value);
    }

    /// <summary>Spoken summary published to UI Automation.</summary>
    public string AccessibleSummary
    {
        get => (string)GetValue(AccessibleSummaryProperty);
        set => SetValue(AccessibleSummaryProperty, value);
    }

    /// <summary>Localized label for the data-table toggle.</summary>
    public string DataViewLabel
    {
        get => (string)GetValue(DataViewLabelProperty);
        set => SetValue(DataViewLabelProperty, value);
    }

    /// <summary>The tabular accessible alternative; bind its <c>Series</c> to mirror the chart.</summary>
    public TsChartDataView DataView => _dataView;

    private static void OnHeaderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var c = (TsChartContainer)d;
        c._title.Value = c.Title;
        c._subtitle.Value = c.Subtitle;
        c._subtitle.Visibility = string.IsNullOrEmpty(c.Subtitle) ? Visibility.Collapsed : Visibility.Visible;
    }

    private static void OnStateChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsChartContainer)d).ApplyState();

    private static void OnBodyChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsChartContainer)d)._bodyPresenter.Content = e.NewValue;

    private static void OnActionsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsChartContainer)d)._actionsHost.Content = e.NewValue;

    private static void OnMessagesChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var c = (TsChartContainer)d;
        c._emptyBody.Value = c.EmptyMessage;
        c._errorBody.Value = c.ErrorMessage;
        c._dataToggle.Content = c.DataViewLabel;
        if (c._loadingBody.Children.Count > 1 && c._loadingBody.Children[1] is Caption caption)
        {
            caption.Value = c.LoadingMessage;
        }

        c.ApplyState();
    }

    private static void OnSummaryChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var c = (TsChartContainer)d;
        AutomationProperties.SetName(c, string.IsNullOrEmpty(c.AccessibleSummary) ? c.Title : c.AccessibleSummary);
    }

    private void ApplyState()
    {
        _bodyPresenter.Visibility = State == ChartState.Ready ? Visibility.Visible : Visibility.Collapsed;
        _loadingBody.Visibility = State == ChartState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _emptyBody.Visibility = State == ChartState.Empty ? Visibility.Visible : Visibility.Collapsed;
        _errorBody.Visibility = State == ChartState.Error ? Visibility.Visible : Visibility.Collapsed;
        _dataToggle.Visibility = State == ChartState.Ready ? Visibility.Visible : Visibility.Collapsed;
        if (State != ChartState.Ready)
        {
            _dataToggle.IsChecked = false;
        }
    }
}
