using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.A11y;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 active-filter-chips surface — a parity port of the web <c>ActiveFilterChips</c>
/// (web/src/components/forms/ActiveFilterChips.tsx). It renders, immediately after a filter bar, a wrapping
/// group (role <see cref="AutomationControlType.Group"/>, web <c>role="group"</c>) of removable pill chips —
/// one per active list-page filter ("Vehicle: Model 3 ×") — collapses every chip past the visible cap into a
/// "+N more" flyout (web overflow popover), shows an optional "Clear all" affordance and announces each removal
/// and clear-all through a hidden polite <see cref="TsAnnouncerRegion"/> (web local
/// <c>&lt;VisuallyHidden liveRegion&gt;</c>). URL state stays owned by the page: every removal flows through the
/// descriptor's <see cref="FilterChipDescriptor.OnRemove"/> callback and clear-all through
/// <see cref="OnClearAll"/>. All state flows through the shared <see cref="ActiveFilterChipsViewModel"/>; the
/// view performs no I/O. Every label resolves through the i18n facade, the group carries the chips' Narrator
/// name, the live region announces politely and each interactive control carries an accessible name.
///
/// <para>
/// State coverage: the web source is a presentational chip summary driven by injected filter descriptors — it
/// performs no data fetch, so it has no loading / error / stale / offline chrome to reproduce. The states it
/// actually has are reproduced in full: hidden (no filters and <see cref="HideWhenEmpty"/> → the group collapses,
/// web <c>return null</c>); the empty-but-shown group (<see cref="HideWhenEmpty"/> = false); the inline chips;
/// the overflow split with its "+N more" trigger + popover (web <c>maxVisible</c> cap, including the
/// <c>maxVisible ≤ 0</c> everything-overflows edge); the optional "Clear all" affordance (only when a callback is
/// supplied AND at least one chip is present); and the polite removal / clear-all announcements with the web's
/// rotating zero-width-space suffix. Reduced-motion needs no handling — the surface animates nothing — and the
/// chips honour the system font scale through their text primitives.
/// </para>
/// </summary>
public sealed partial class ActiveFilterChips : ContentControl, IDisposable
{
    private const string RemoveGlyph = "\uE711";    // Segoe Fluent "ChromeClose" — the web chip X (Icons.close).
    private const double ChipGap = 8;               // web gap-2 between chips / trailing affordances.
    private const double ChipCornerRadius = 999;    // web rounded-full pill.
    private const double OverflowChipGap = 4;       // web flex-col gap-1 inside the overflow popover.
    private const double OverflowMinWidth = 192;    // web min-w-[12rem] popover.

    private readonly ActiveFilterChipsViewModel _viewModel;
    private readonly ActiveFilterChipsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly ChipWrapPanel _chips = new() { HorizontalSpacing = ChipGap, VerticalSpacing = ChipGap };
    private readonly TsAnnouncerRegion _live = new();
    private readonly TsButton _more = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _clearAll = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly Flyout _overflowFlyout = new();
    private readonly StackPanel _overflowContent = new() { Spacing = OverflowChipGap };

    private bool _opened;
    private bool _renderQueued;
    private bool _syncingOverflow;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over the passthrough localizer — the native analogue of mounting the web
    /// component with no filters in an isolated host. Production callers use the seam constructor.
    /// </summary>
    public ActiveFilterChips()
        : this(PassthroughLocalizer.Instance, diagnostics: null)
    {
    }

    /// <summary>Creates the surface over the i18n facade and an optional PII-safe diagnostics collector.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ActiveFilterChips(ILocalizer localizer, ActiveFilterChipsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _diagnostics = diagnostics ?? new ActiveFilterChipsDiagnostics();

        // The web component owns a local polite live region; back the announcer with this surface's hidden region.
        var announcer = new LiveRegionFilterChipAnnouncer(_live, _dispatcher);
        _viewModel = new ActiveFilterChipsViewModel(localizer, announcer);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        // The overflow flyout reproduces the web popover: light-dismiss + Escape come for free, and the content
        // host carries the popover's accessible name (web role="menu" aria-label={t('filters.moreLabel')}).
        var overflowHost = new Border
        {
            MinWidth = OverflowMinWidth,
            Child = _overflowContent,
        };
        AutomationProperties.SetName(overflowHost, _viewModel.MoreLabel);
        AutomationProperties.SetAccessibilityView(overflowHost, AccessibilityView.Content);
        _overflowFlyout.Content = overflowHost;
        _more.Flyout = _overflowFlyout;

        Content = _chips;

        _clearAll.Click += OnClearAllClicked;
        _overflowFlyout.Opened += OnOverflowOpened;
        _overflowFlyout.Closed += OnOverflowClosed;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>ActiveFilterChips</c>).</summary>
    public static string Slug => ActiveFilterChipsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ActiveFilterChipsViewModel ViewModel => _viewModel;

    /// <summary>The inline chip cap before chips collapse into the "+N more" popover (web <c>maxVisible</c>).</summary>
    public int MaxVisible
    {
        get => _viewModel.MaxVisible;
        set => _viewModel.MaxVisible = value;
    }

    /// <summary>When true (default) the surface renders nothing while there are no filters (web <c>hideWhenEmpty</c>).</summary>
    public bool HideWhenEmpty
    {
        get => _viewModel.HideWhenEmpty;
        set => _viewModel.HideWhenEmpty = value;
    }

    /// <summary>The page-owned clear-all callback (web <c>onClearAll?</c>); when null the affordance is not rendered.</summary>
    public Action? OnClearAll
    {
        get => _viewModel.OnClearAll;
        set => _viewModel.OnClearAll = value;
    }

    /// <summary>Replace the active filters, re-rendering the chips (web <c>filters</c> prop change).</summary>
    public void SetFilters(IReadOnlyList<FilterChipDescriptor> filters) => _viewModel.SetFilters(filters);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _clearAll.Click -= OnClearAllClicked;
        _overflowFlyout.Opened -= OnOverflowOpened;
        _overflowFlyout.Closed -= OnOverflowClosed;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ActiveFilterChipsAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnClearAllClicked(object sender, RoutedEventArgs e) => _viewModel.RequestClearAll();

    private void OnOverflowOpened(object? sender, object e)
    {
        if (_syncingOverflow)
        {
            return;
        }

        _viewModel.OverflowOpen = true;
    }

    private void OnOverflowClosed(object? sender, object e)
    {
        if (_syncingOverflow)
        {
            return;
        }

        _viewModel.OverflowOpen = false;
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
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

    private void Render()
    {
        // The group collapses entirely when there is nothing to show and hideWhenEmpty is set (web return null).
        Visibility = _viewModel.IsRendered ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(this, _viewModel.ActiveLabel);
        AutomationProperties.SetName(_chips, _viewModel.ActiveLabel);

        _chips.Children.Clear();

        foreach (FilterChipDescriptor descriptor in _viewModel.Visible)
        {
            _chips.Children.Add(BuildChip(descriptor, fullWidth: false));
        }

        if (_viewModel.HasOverflow)
        {
            _more.Text = _viewModel.MoreCountLabel;
            AutomationProperties.SetName(_more, _viewModel.MoreCountLabel);
            RebuildOverflowContent();
            _chips.Children.Add(_more);
        }
        else
        {
            // No overflow bucket: collapse the popover if it is still open (web filters-drop-to-zero effect).
            HideOverflowSilently();
        }

        if (_viewModel.ShowClearAll)
        {
            _clearAll.Text = _viewModel.ClearAllLabel;
            AutomationProperties.SetName(_clearAll, _viewModel.ClearAllLabel);
            _chips.Children.Add(_clearAll);
        }

        // The hidden polite live region is always present so announcements are voiced (web liveRegion node).
        _chips.Children.Add(_live);
    }

    private void RebuildOverflowContent()
    {
        _overflowContent.Children.Clear();
        foreach (FilterChipDescriptor descriptor in _viewModel.Overflow)
        {
            _overflowContent.Children.Add(BuildChip(descriptor, fullWidth: true));
        }
    }

    private Border BuildChip(FilterChipDescriptor descriptor, bool fullWidth)
    {
        var label = new TextBlock
        {
            Text = descriptor.Label + ":",
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            Foreground = TypographyTokens.Brush("TsColorTextMutedBrush"),
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var value = new TextBlock
        {
            Text = descriptor.Value,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            Foreground = TypographyTokens.Brush("TsColorTextPrimaryBrush"),
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var caption = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        caption.Children.Add(label);
        caption.Children.Add(value);

        var remove = new TsButton
        {
            Variant = ButtonVariant.Icon,
            Size = ControlSize.Small,
            IconGlyph = RemoveGlyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(remove, _viewModel.RemoveAriaFor(descriptor));
        AutomationProperties.SetAutomationId(remove, descriptor.Key);

        FilterChipDescriptor current = descriptor;
        remove.Click += (_, _) => RemoveChip(current);
        remove.KeyDown += (_, e) =>
        {
            // web handleChipKey: Backspace / Delete on the X also removes the filter.
            if (e.Key is Windows.System.VirtualKey.Back or Windows.System.VirtualKey.Delete)
            {
                e.Handled = true;
                RemoveChip(current);
            }
        };

        var content = ComposeChipContent(caption, remove, fullWidth);

        return new Border
        {
            Child = content,
            CornerRadius = new CornerRadius(ChipCornerRadius),
            BorderBrush = TypographyTokens.Brush("TsColorBorderBrush"),
            BorderThickness = new Thickness(1),
            Background = TypographyTokens.Brush("TsColorSurfaceGlassBrush"),
            Padding = new Thickness(10, 2, 4, 2),
            HorizontalAlignment = fullWidth ? HorizontalAlignment.Stretch : HorizontalAlignment.Left,
        };
    }

    private static FrameworkElement ComposeChipContent(StackPanel caption, TsButton remove, bool fullWidth)
    {
        if (!fullWidth)
        {
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 4,
                VerticalAlignment = VerticalAlignment.Center,
            };
            row.Children.Add(caption);
            row.Children.Add(remove);
            return row;
        }

        // web fullWidth chip: w-full justify-between — caption on the left, remove pinned to the trailing edge.
        var grid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Auto) });
        Grid.SetColumn(caption, 0);
        Grid.SetColumn(remove, 1);
        grid.Children.Add(caption);
        grid.Children.Add(remove);
        return grid;
    }

    private void RemoveChip(FilterChipDescriptor descriptor)
    {
        // web: removing the last overflow chip also closes the popover.
        bool wasLastOverflow = _viewModel.Overflow.Count == 1 && Contains(_viewModel.Overflow, descriptor);
        _viewModel.Remove(descriptor);
        if (wasLastOverflow)
        {
            HideOverflowSilently();
        }
    }

    private void HideOverflowSilently()
    {
        _syncingOverflow = true;
        try
        {
            _overflowFlyout.Hide();
        }
        finally
        {
            _syncingOverflow = false;
        }

        if (_viewModel.OverflowOpen)
        {
            _viewModel.OverflowOpen = false;
        }
    }

    private static bool Contains(IReadOnlyList<FilterChipDescriptor> list, FilterChipDescriptor descriptor)
    {
        for (int i = 0; i < list.Count; i++)
        {
            if (ReferenceEquals(list[i], descriptor))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Exposes the surface as a named <see cref="AutomationControlType.Group"/> so Narrator reports the chips as
    /// the localized "Active filters" region (web <c>role="group" aria-label</c>).
    /// </summary>
    private sealed class ActiveFilterChipsAutomationPeer : FrameworkElementAutomationPeer
    {
        public ActiveFilterChipsAutomationPeer(ActiveFilterChips owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((ActiveFilterChips)Owner).ViewModel.ActiveLabel
                : name;
        }
    }

    /// <summary>
    /// A minimal flow panel that lays its children left to right and wraps to a new row when the next child would
    /// overflow the available width — the native equivalent of the web group's <c>flex flex-wrap items-center
    /// gap-2</c>. Base WinUI ships no wrap panel, so the surface carries its own (the same pattern the dashboard
    /// chip clusters and the suggested-prompts row use).
    /// </summary>
    private sealed partial class ChipWrapPanel : Panel
    {
        /// <summary>Horizontal gap between chips on a row.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped rows.</summary>
        public double VerticalSpacing { get; set; }

        protected override Size MeasureOverride(Size availableSize)
        {
            double maxWidth = double.IsNaN(availableSize.Width) || double.IsInfinity(availableSize.Width)
                ? double.PositiveInfinity
                : availableSize.Width;

            double rowWidth = 0;
            double rowHeight = 0;
            double totalHeight = 0;
            double widest = 0;

            foreach (var child in Children)
            {
                child.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                var desired = child.DesiredSize;

                if (rowWidth > 0 && rowWidth + HorizontalSpacing + desired.Width > maxWidth)
                {
                    widest = Math.Max(widest, rowWidth);
                    totalHeight += rowHeight + VerticalSpacing;
                    rowWidth = desired.Width;
                    rowHeight = desired.Height;
                }
                else
                {
                    rowWidth += (rowWidth > 0 ? HorizontalSpacing : 0) + desired.Width;
                    rowHeight = Math.Max(rowHeight, desired.Height);
                }
            }

            widest = Math.Max(widest, rowWidth);
            totalHeight += rowHeight;

            double measuredWidth = double.IsInfinity(maxWidth) ? widest : maxWidth;
            return new Size(measuredWidth, totalHeight);
        }

        protected override Size ArrangeOverride(Size finalSize)
        {
            double x = 0;
            double y = 0;
            double rowHeight = 0;

            foreach (var child in Children)
            {
                var desired = child.DesiredSize;
                if (x > 0 && x + HorizontalSpacing + desired.Width > finalSize.Width)
                {
                    x = 0;
                    y += rowHeight + VerticalSpacing;
                    rowHeight = 0;
                }

                if (x > 0)
                {
                    x += HorizontalSpacing;
                }

                child.Arrange(new Rect(x, y, desired.Width, desired.Height));
                x += desired.Width;
                rowHeight = Math.Max(rowHeight, desired.Height);
            }

            return finalSize;
        }
    }
}

/// <summary>
/// The real WinUI live-region announcer — the native analogue of the web component's local
/// <c>&lt;VisuallyHidden liveRegion&gt;</c> (web/src/components/a11y/VisuallyHidden.tsx). It marshals each
/// announcement onto the UI thread and writes it to a hidden polite <see cref="TsAnnouncerRegion"/>, so a removal
/// or clear-all is voiced by Narrator without moving focus. The view-model depends only on the
/// <see cref="IFilterChipAnnouncer"/> seam, so its announcement logic is verified headlessly with a recording
/// double.
/// </summary>
public sealed class LiveRegionFilterChipAnnouncer : IFilterChipAnnouncer
{
    private readonly TsAnnouncerRegion _region;
    private readonly DispatcherQueue? _dispatcher;

    /// <summary>Creates the announcer over the hidden live region and the surface's dispatcher (for marshalling).</summary>
    public LiveRegionFilterChipAnnouncer(TsAnnouncerRegion region, DispatcherQueue? dispatcher)
    {
        ArgumentNullException.ThrowIfNull(region);
        _region = region;
        _dispatcher = dispatcher;
    }

    /// <inheritdoc />
    public void Announce(string message)
    {
        ArgumentNullException.ThrowIfNull(message);

        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => _region.Announce(message));
        }
        else
        {
            _region.Announce(message);
        }
    }
}
