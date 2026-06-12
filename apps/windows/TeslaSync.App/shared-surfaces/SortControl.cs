using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>SortControl</c> shared surface — a parity port of the web <c>SortControl</c>
/// (web/src/components/forms/SortControl.tsx). It is the shared sort control: a field dropdown (the native
/// <see cref="TsSelect"/>, the counterpart of the web <c>@/components/ui/Select</c>) followed by a direction
/// toggle (an icon <see cref="TsButton"/>) whose arrow glyph encodes ascending / descending so the current
/// state is readable at a glance, exactly as the web UX critique demands. All state flows through the shared
/// <see cref="SortControlViewModel"/> over the <see cref="SortControlSource"/> P1/S8 seam; the view performs
/// no I/O and never recomputes — it renders the <see cref="SortControlDisplay"/> projection and drives the
/// seam's mutators on interaction (field selection → <c>onFieldChange</c>, toggle click → <c>flip</c>). The
/// dropdown carries the localized "Sort by" Narrator name, the toggle carries the localized
/// "Sort direction: …" name + tooltip, and an empty option set renders a labeled, disabled picker rather than
/// a blank box. Every string resolves through the i18n facade.
///
/// <para>
/// Native idiom note: the web component is a controlled, presentational primitive with no query-freshness or
/// connectivity concept, so it has no loading / error / stale / offline chrome to reproduce — the populated
/// and empty option sets across the two direction states are the complete set the source renders.
/// </para>
/// </summary>
public sealed partial class SortControl : ContentControl, IDisposable
{
    private const double RowSpacing = 4; // web gap-1.

    private readonly SortControlSource _source;
    private readonly SortControlViewModel _viewModel;
    private readonly SortControlDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = RowSpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsSelect _select = new()
    {
        DisplayMemberPath = nameof(SortControlOption.Label),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _directionButton = new()
    {
        Variant = ButtonVariant.Icon,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private IReadOnlyList<SortControlOption>? _boundOptions;
    private bool _suppressSelection;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its state seam, localizer and optional diagnostics collector.</summary>
    public SortControl(SortControlSource source, ILocalizer localizer, SortControlDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _diagnostics = diagnostics ?? new SortControlDiagnostics();
        _viewModel = new SortControlViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        _root.Children.Add(_select);
        _root.Children.Add(_directionButton);
        Content = _root;

        _select.SelectionChanged += OnSelectionChanged;
        _directionButton.Click += OnDirectionClicked;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics slug this surface registers under (<c>SortControl</c>).</summary>
    public static string Slug => SortControlRegistration.Slug;

    /// <summary>The state seam a host drives and observes (field / direction change events).</summary>
    public SortControlSource Source => _source;

    /// <summary>The view-model a host can observe for the current render state.</summary>
    public SortControlViewModel ViewModel => _viewModel;

    /// <summary>Detach from the view-model and controls (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _select.SelectionChanged -= OnSelectionChanged;
        _directionButton.Click -= OnDirectionClicked;
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
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressSelection)
        {
            return;
        }

        if (_select.SelectedItem is SortControlOption option)
        {
            _source.SetField(option.Value);
        }
    }

    private void OnDirectionClicked(object sender, RoutedEventArgs e) => _source.ToggleDirection();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(SortControlViewModel.Display))
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

        // A source change can arrive from a host callback off the UI thread; render on the UI thread.
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
        SortControlDisplay display = _viewModel.Display;

        // Direction toggle: arrow glyph for the current direction, with the Narrator name + tooltip.
        _directionButton.IconGlyph = display.DirectionGlyph;
        AutomationProperties.SetName(_directionButton, display.DirectionAccessibleName);
        ToolTipService.SetToolTip(_directionButton, display.DirectionLabel);

        // Field dropdown: the "Sort by" Narrator name; disabled (never blank) when there are no options.
        AutomationProperties.SetName(_select, display.FieldLabel);
        _select.IsEnabled = !display.IsEmpty;

        if (!ReferenceEquals(_boundOptions, display.Options))
        {
            _boundOptions = display.Options;
            _suppressSelection = true;
            _select.ItemsSource = display.Options;
            _suppressSelection = false;
        }

        SyncSelection(display);
    }

    private void SyncSelection(SortControlDisplay display)
    {
        SortControlOption? target = FindBoundOption(display.SelectedValue);
        if (ReferenceEquals(_select.SelectedItem, target))
        {
            return;
        }

        _suppressSelection = true;
        _select.SelectedItem = target;
        _suppressSelection = false;
    }

    private SortControlOption? FindBoundOption(string value)
    {
        if (_boundOptions is null)
        {
            return null;
        }

        for (int i = 0; i < _boundOptions.Count; i++)
        {
            if (string.Equals(_boundOptions[i].Value, value, StringComparison.Ordinal))
            {
                return _boundOptions[i];
            }
        }

        return null;
    }
}
