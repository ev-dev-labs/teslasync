using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>DateGroupedList</c> shared surface — a parity port of
/// web/src/components/data-display/DateGroupedList.tsx. It is a generic, controlled, presentational list:
/// bound to an <see cref="IDateGroupedListSource{T}"/> (the P1/S8 seam standing in for the web
/// <c>groups</c> prop) and given a <c>renderItem</c> delegate (the web <c>renderItem</c> render prop), it
/// renders one labelled section per bucket. Each section opens with a divider row — the bold primary date
/// label, an optional muted "· {relativeLabel}", a hairline rule that fills the remaining width and an
/// optional right-aligned muted summary — and then the bucket's items, each produced by the delegate, with
/// the web inter-item and inter-group spacing. When there are no buckets the container is kept present but
/// childless, the native analogue of the web empty container (<c>&lt;div data-testid /&gt;</c> with no
/// sections). There is no loading / error / stale / offline chrome because the web source is a controlled
/// component with no data fetch; its only states are the empty list (an empty container) and the populated
/// list. All state lives in the UI-thread-free <see cref="DateGroupedListViewModel{T}"/>; this view only
/// owns the WinUI wiring — it observes the holder, marshals re-renders onto its captured
/// <see cref="DispatcherQueue"/> (the source may swap from a background callback) and emits the
/// <c>view.opened</c> diagnostic once on load.
/// </summary>
/// <remarks>
/// The web <c>itemKey</c> prop has no native counterpart: it is purely a React reconciliation hint
/// ("avoids re-render thrash"), whereas this view rebuilds its children imperatively on each change, so
/// there is no keyed diffing to optimise. The web <c>summary</c> <c>ReactNode</c> is realised as text — the
/// documented and only-used "2 drives · 6.2 mi" form — so the bucket stays free of view types.
/// </remarks>
/// <typeparam name="T">The item type each bucket holds (the web generic parameter).</typeparam>
public sealed partial class DateGroupedList<T> : ContentControl, IDisposable
{
    private readonly DateGroupedListViewModel<T> _viewModel;
    private readonly Func<T, int, UIElement> _renderItem;
    private readonly double _itemSpacing;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _root;

    private bool _renderQueued;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over its bucket seam, the per-item render delegate and an optional diagnostics collector.</summary>
    /// <param name="source">The grouped-bucket seam (P1/S8) the list binds to (web <c>groups</c>).</param>
    /// <param name="renderItem">Produces the visual for an item given the item and its zero-based index in the bucket (web <c>renderItem</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="groupSpacing">Vertical gap between successive groups (web <c>groupSpacing</c>; defaults to the web <c>space-y-6</c>).</param>
    /// <param name="itemSpacing">Vertical gap between successive items in a group (web <c>itemSpacing</c>; defaults to the web <c>space-y-3</c>).</param>
    public DateGroupedList(
        IDateGroupedListSource<T> source,
        Func<T, int, UIElement> renderItem,
        DateGroupedListDiagnostics? diagnostics = null,
        double groupSpacing = DateGroupedListLayout.GroupSpacing,
        double itemSpacing = DateGroupedListLayout.ItemSpacing)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(renderItem);

        _viewModel = new DateGroupedListViewModel<T>(source, diagnostics);
        _renderItem = renderItem;
        _itemSpacing = itemSpacing;
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _root = new StackPanel { Spacing = groupSpacing };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        // web data-testid: the container is discoverable even while empty.
        AutomationProperties.SetAutomationId(this, DateGroupedListRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _root;
        Render();
    }

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests). The canonical
    /// diagnostics slug lives on the non-generic <see cref="DateGroupedListRegistration.Slug"/>.</summary>
    public DateGroupedListViewModel<T> ViewModel => _viewModel;

    /// <summary>Detach from the view-model and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _viewModel.NotifyOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => ScheduleRender();

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
        // web: the container always renders; an empty groups array simply yields no sections (the empty
        // container the web spec asserts is `toBeEmptyDOMElement`).
        _root.Children.Clear();
        foreach (var group in _viewModel.Groups)
        {
            _root.Children.Add(BuildSection(group));
        }
    }

    private StackPanel BuildSection(DateGroupedListGroup<T> group)
    {
        var header = DateGroupedListProjection.Header(group);

        var section = new StackPanel();
        section.Children.Add(BuildHeader(header));
        section.Children.Add(BuildItems(group.Items));

        // web <section aria-labelledby={`date-group-${dateKey}`} data-date-key={dateKey}>: the section is a
        // landmark named by its header, discoverable by the per-bucket id.
        AutomationProperties.SetName(section, header.AccessibleName);
        AutomationProperties.SetAutomationId(section, header.SectionId);
        AutomationProperties.SetLandmarkType(section, AutomationLandmarkType.Custom);
        return section;
    }

    private static Grid BuildHeader(DateGroupedListHeader header)
    {
        var grid = new Grid
        {
            ColumnSpacing = DateGroupedListLayout.HeaderColumnSpacing,
            Margin = new Thickness(0, 0, 0, DateGroupedListLayout.HeaderBottomMargin),
            VerticalAlignment = VerticalAlignment.Center,
        };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });                       // labels
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });  // divider
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });                       // summary

        // web: <div className="flex items-center gap-2 ..."> with the bold label and optional muted relative span.
        var labels = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = DateGroupedListLayout.LabelGroupSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        labels.Children.Add(new TextBlock
        {
            Text = header.DateLabel,
            FontSize = DateGroupedListLayout.HeaderFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });

        if (header.HasRelativeLabel)
        {
            labels.Children.Add(new TextBlock
            {
                Text = header.RelativeDisplay,
                FontSize = DateGroupedListLayout.HeaderFontSize,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        Grid.SetColumn(labels, 0);
        grid.Children.Add(labels);

        // web: <div className="flex-1 h-px bg-[var(--glass-border)] opacity-50" aria-hidden /> — a decorative
        // hairline that fills the gap between the label and the summary.
        var divider = new Rectangle
        {
            Height = DateGroupedListLayout.DividerThickness,
            Fill = DisplayTokens.Border,
            Opacity = DateGroupedListLayout.DividerOpacity,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(divider, AccessibilityView.Raw);
        Grid.SetColumn(divider, 1);
        grid.Children.Add(divider);

        if (header.HasSummary)
        {
            // web: <span className="text-xs text-[var(--text-muted)] tabular-nums">{summary}</span>.
            var summary = new TextBlock
            {
                Text = header.Summary,
                FontSize = DateGroupedListLayout.HeaderFontSize,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            Typography.SetNumeralAlignment(summary, FontNumeralAlignment.Tabular);
            Grid.SetColumn(summary, 2);
            grid.Children.Add(summary);
        }

        return grid;
    }

    private StackPanel BuildItems(IReadOnlyList<T> items)
    {
        var panel = new StackPanel { Spacing = _itemSpacing };
        for (int i = 0; i < items.Count; i++)
        {
            panel.Children.Add(_renderItem(items[i], i));
        }

        return panel;
    }
}
