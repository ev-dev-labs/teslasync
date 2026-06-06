using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized pager (mirrors the web <c>Pagination</c>). Wraps a
/// <see cref="PaginationState"/> for clamping/range maths and renders
/// first/prev/next/last navigation plus a localizable summary. All user-facing
/// text is consumer-supplied so the primitive ships no hardcoded strings.
/// </summary>
public partial class TsPagination : ContentControl
{
    private readonly PaginationState _state = new();
    private readonly TsButton _first = new() { Variant = ButtonVariant.Subtle, IconGlyph = "\uE892" };
    private readonly TsButton _prev = new() { Variant = ButtonVariant.Subtle, IconGlyph = "\uE76B" };
    private readonly TsButton _next = new() { Variant = ButtonVariant.Subtle, IconGlyph = "\uE76C" };
    private readonly TsButton _last = new() { Variant = ButtonVariant.Subtle, IconGlyph = "\uE893" };
    private readonly TextBlock _summary = new() { VerticalAlignment = VerticalAlignment.Center };

    public static readonly DependencyProperty PageProperty = DependencyProperty.Register(
        nameof(Page), typeof(int), typeof(TsPagination), new PropertyMetadata(1, OnPageChanged));

    public static readonly DependencyProperty PageSizeProperty = DependencyProperty.Register(
        nameof(PageSize), typeof(int), typeof(TsPagination), new PropertyMetadata(25, OnTotalsChanged));

    public static readonly DependencyProperty TotalItemsProperty = DependencyProperty.Register(
        nameof(TotalItems), typeof(int), typeof(TsPagination), new PropertyMetadata(0, OnTotalsChanged));

    public static readonly DependencyProperty SummaryFormatProperty = DependencyProperty.Register(
        nameof(SummaryFormat), typeof(string), typeof(TsPagination),
        new PropertyMetadata("{0}\u2013{1} / {2}", OnLabelsChanged));

    public static readonly DependencyProperty FirstLabelProperty = DependencyProperty.Register(
        nameof(FirstLabel), typeof(string), typeof(TsPagination), new PropertyMetadata(null, OnLabelsChanged));

    public static readonly DependencyProperty PreviousLabelProperty = DependencyProperty.Register(
        nameof(PreviousLabel), typeof(string), typeof(TsPagination), new PropertyMetadata(null, OnLabelsChanged));

    public static readonly DependencyProperty NextLabelProperty = DependencyProperty.Register(
        nameof(NextLabel), typeof(string), typeof(TsPagination), new PropertyMetadata(null, OnLabelsChanged));

    public static readonly DependencyProperty LastLabelProperty = DependencyProperty.Register(
        nameof(LastLabel), typeof(string), typeof(TsPagination), new PropertyMetadata(null, OnLabelsChanged));

    public TsPagination()
    {
        IsTabStop = false;
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        panel.Children.Add(_first);
        panel.Children.Add(_prev);
        panel.Children.Add(_summary);
        panel.Children.Add(_next);
        panel.Children.Add(_last);
        Content = panel;

        _first.Click += (s, e) => GoTo(1);
        _prev.Click += (s, e) => GoTo(_state.Page - 1);
        _next.Click += (s, e) => GoTo(_state.Page + 1);
        _last.Click += (s, e) => GoTo(_state.PageCount);

        SyncState();
    }

    /// <summary>Raised after a navigation action changes the current page.</summary>
    public event EventHandler<int>? PageChanged;

    public int Page
    {
        get => (int)GetValue(PageProperty);
        set => SetValue(PageProperty, value);
    }

    public int PageSize
    {
        get => (int)GetValue(PageSizeProperty);
        set => SetValue(PageSizeProperty, value);
    }

    public int TotalItems
    {
        get => (int)GetValue(TotalItemsProperty);
        set => SetValue(TotalItemsProperty, value);
    }

    /// <summary>Composite format string: <c>{0}</c>=range start, <c>{1}</c>=range end, <c>{2}</c>=total.</summary>
    public string SummaryFormat
    {
        get => (string)GetValue(SummaryFormatProperty);
        set => SetValue(SummaryFormatProperty, value);
    }

    public string? FirstLabel
    {
        get => (string?)GetValue(FirstLabelProperty);
        set => SetValue(FirstLabelProperty, value);
    }

    public string? PreviousLabel
    {
        get => (string?)GetValue(PreviousLabelProperty);
        set => SetValue(PreviousLabelProperty, value);
    }

    public string? NextLabel
    {
        get => (string?)GetValue(NextLabelProperty);
        set => SetValue(NextLabelProperty, value);
    }

    public string? LastLabel
    {
        get => (string?)GetValue(LastLabelProperty);
        set => SetValue(LastLabelProperty, value);
    }

    private static void OnPageChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var pager = (TsPagination)d;
        pager._state.Page = (int)e.NewValue;
        pager.SyncState();
    }

    private static void OnTotalsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var pager = (TsPagination)d;
        pager._state.PageSize = pager.PageSize;
        pager._state.Total = pager.TotalItems;
        pager.SyncState();
    }

    private static void OnLabelsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsPagination)d).SyncState();

    private void GoTo(int page)
    {
        _state.Page = page;
        if (_state.Page != Page)
        {
            Page = _state.Page;
        }
        else
        {
            SyncState();
        }

        PageChanged?.Invoke(this, _state.Page);
    }

    private void SyncState()
    {
        _state.PageSize = PageSize;
        _state.Total = TotalItems;
        _state.Page = Page;

        _summary.Text = string.Format(
            System.Globalization.CultureInfo.CurrentCulture,
            SummaryFormat,
            _state.RangeStart,
            _state.RangeEnd,
            _state.Total);

        _first.IsEnabled = _state.CanGoPrevious;
        _prev.IsEnabled = _state.CanGoPrevious;
        _next.IsEnabled = _state.CanGoNext;
        _last.IsEnabled = _state.CanGoNext;

        ApplyLabel(_first, FirstLabel);
        ApplyLabel(_prev, PreviousLabel);
        ApplyLabel(_next, NextLabel);
        ApplyLabel(_last, LastLabel);
    }

    private static void ApplyLabel(TsButton button, string? label)
    {
        if (!string.IsNullOrEmpty(label))
        {
            AutomationProperties.SetName(button, label);
            ToolTipService.SetToolTip(button, label);
        }
    }
}
