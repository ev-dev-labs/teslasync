using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>AnnotationList</c> shared surface — a parity port of
/// web/src/components/charts/AnnotationList.tsx. It is a controlled, presentational list: bound to an
/// <see cref="IAnnotationListSource"/> (the P1/S8 seam standing in for the web <c>annotations</c> +
/// <c>onRemove</c> props), it renders the localized "Annotations" title above one row per annotation. Each row
/// shows the category colour dot (the web <c>ANNOTATION_COLORS[category]</c> inline swatch), the label, the
/// optional "— description" segment, the right-aligned timestamp and a remove button carrying the localized
/// "Remove annotation" accessible name. When there are no annotations the whole surface contributes nothing
/// visible — the native analogue of the web <c>if (annotations.length === 0) return null;</c>. There is no
/// loading / error / stale / offline chrome because the web source is a controlled component with no data fetch;
/// its only states are the empty list (rendered as nothing) and the populated list. All state lives in the
/// UI-thread-free <see cref="AnnotationListViewModel"/>; this view only owns the WinUI wiring — it observes the
/// holder, marshals re-renders onto its captured <see cref="DispatcherQueue"/> (the source may mutate from a
/// background callback) and emits the <c>view.opened</c> diagnostic once on load.
/// </summary>
public sealed partial class AnnotationList : ContentControl, IDisposable
{
    private const double RootSpacing = 4;        // web space-y-1
    private const double RootTopMargin = 8;      // web mt-2
    private const double RowColumnSpacing = 8;   // web gap-2
    private const double RowCornerRadius = 8;    // web rounded-lg
    private const double RowPaddingX = 12;       // web px-3
    private const double RowPaddingY = 6;        // web py-1.5
    private const double DotSize = 8;            // web h-2 w-2
    private const double RowFontSize = 12;       // web text-xs
    private const string EmDashPrefix = "\u2014 ";  // web "— {description}"
    private const string RemoveGlyph = "\uE711";    // Segoe Fluent "Cancel" (X) — the web lucide <X/> mark.

    private readonly AnnotationListViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new()
    {
        Spacing = RootSpacing,
        Margin = new Thickness(0, RootTopMargin, 0, 0),
    };

    private readonly Caption _title = new();
    private readonly StackPanel _items = new() { Spacing = RootSpacing };

    private bool _renderQueued;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over its annotation seam, the localizer and an optional diagnostics collector.</summary>
    /// <param name="source">The annotation collection seam (P1/S8) the list binds to.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AnnotationList(
        IAnnotationListSource source,
        ILocalizer localizer,
        AnnotationListDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new AnnotationListViewModel(source, localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        BuildChrome();
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _root;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AnnotationList</c>).</summary>
    public static string Slug => AnnotationListRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public AnnotationListViewModel ViewModel => _viewModel;

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

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new AnnotationListAutomationPeer(this);

    private void BuildChrome()
    {
        _title.Value = _viewModel.Title;
        _root.Children.Add(_title);
        _root.Children.Add(_items);
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
        if (_viewModel.IsEmpty)
        {
            // web: `if (annotations.length === 0) return null;` — contribute nothing visible and carry no
            // automation id so an empty list is not a discoverable element.
            Visibility = Visibility.Collapsed;
            AutomationProperties.SetAutomationId(this, string.Empty);
            _items.Children.Clear();
            return;
        }

        Visibility = Visibility.Visible;
        AutomationProperties.SetAutomationId(this, AnnotationListRegistration.RootAutomationId);

        _title.Value = _viewModel.Title;
        AutomationProperties.SetName(this, _viewModel.Title);

        _items.Children.Clear();
        foreach (var row in _viewModel.Rows)
        {
            _items.Children.Add(BuildRow(row));
        }
    }

    private Border BuildRow(AnnotationRow row)
    {
        var grid = new Grid
        {
            ColumnSpacing = RowColumnSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });                       // dot
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });                       // label
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });  // description
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });                       // timestamp
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });                       // remove

        var dot = DisplayPrimitives.Dot(DisplayPrimitives.HexBrush(row.ColorHex), DotSize);
        Grid.SetColumn(dot, 0);
        grid.Children.Add(dot);

        var label = new TextBlock
        {
            Text = row.Label,
            FontSize = RowFontSize,
            FontWeight = Microsoft.UI.Text.FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        Grid.SetColumn(label, 1);
        grid.Children.Add(label);

        if (row.HasDescription)
        {
            var description = new TextBlock
            {
                Text = string.Concat(EmDashPrefix, row.Description),
                FontSize = RowFontSize,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
            };
            Grid.SetColumn(description, 2);
            grid.Children.Add(description);
        }

        var timestamp = new TextBlock
        {
            Text = row.Timestamp,
            FontSize = RowFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        Grid.SetColumn(timestamp, 3);
        grid.Children.Add(timestamp);

        // web ghost icon button. Kept always-visible (not hover-only) so Narrator / keyboard users can always
        // reach the remove action; the web opacity-on-hover is a pointer-only cosmetic.
        var remove = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = RemoveGlyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(remove, _viewModel.RemoveLabel);
        ToolTipService.SetToolTip(remove, _viewModel.RemoveLabel);
        var id = row.Id;
        remove.Click += (_, _) => _viewModel.Remove(id);
        Grid.SetColumn(remove, 4);
        grid.Children.Add(remove);

        return new Border
        {
            Child = grid,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", RowCornerRadius),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(RowPaddingX, RowPaddingY, RowPaddingX, RowPaddingY),
        };
    }

    /// <summary>
    /// Exposes the list as an accessible group whose name is the localized title, so Narrator announces the
    /// "Annotations" grouping that wraps the rows (the web container's labelled region).
    /// </summary>
    private sealed class AnnotationListAutomationPeer : FrameworkElementAutomationPeer
    {
        public AnnotationListAutomationPeer(AnnotationList owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((AnnotationList)Owner).ViewModel.Title : name;
        }
    }
}
