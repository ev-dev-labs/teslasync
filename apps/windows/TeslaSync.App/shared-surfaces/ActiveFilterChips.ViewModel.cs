using System.Collections.Generic;
using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ActiveFilterChips"/> view — the native port of the
/// web component body (web/src/components/forms/ActiveFilterChips.tsx). It mirrors the web source exactly: the
/// surface renders nothing when there are no filters and <see cref="HideWhenEmpty"/> is set
/// (<see cref="IsRendered"/> = web <c>hideWhenEmpty &amp;&amp; isEmpty ? null</c>); the chips split into an inline
/// <see cref="Visible"/> bucket and a collapsed <see cref="Overflow"/> bucket using the web <c>useMemo</c> rule
/// (<see cref="MaxVisible"/> ≤ 0 → everything overflows; ≤ cap → everything inline; otherwise cap − 1 inline plus
/// the rest behind the "+N more" trigger); the "+N more" trigger label interpolates the overflow count
/// (<see cref="MoreCountLabel"/>); the "Clear all" affordance shows only when an <see cref="OnClearAll"/> callback
/// is supplied and at least one chip is present (<see cref="ShowClearAll"/>); and every removal + clear-all is
/// announced politely (<see cref="IFilterChipAnnouncer"/>) with the web's rotating zero-width-space suffix so an
/// otherwise-identical announcement is re-read. The view binds the projected labels + buckets and never performs
/// I/O. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ActiveFilterChipsViewModel : INotifyPropertyChanged
{
    /// <summary>The web default chip cap (<c>maxVisible = 8</c>).</summary>
    public const int DefaultMaxVisible = 8;

    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);
    private static readonly IReadOnlyList<FilterChipDescriptor> Empty = Array.Empty<FilterChipDescriptor>();

    private readonly ILocalizer _localizer;
    private readonly IFilterChipAnnouncer _announcer;

    private IReadOnlyList<FilterChipDescriptor> _filters = Empty;
    private Action? _onClearAll;
    private int _maxVisible = DefaultMaxVisible;
    private bool _hideWhenEmpty = true;
    private bool _overflowOpen;
    private int _announceCounter;

    private IReadOnlyList<FilterChipDescriptor>? _visibleCache;
    private IReadOnlyList<FilterChipDescriptor>? _overflowCache;

    /// <summary>Creates the holder over the i18n facade and the polite live-region announcer (P1/S8).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="announcer">The live-region seam removals + clear-all are announced through (web local <c>aria-live</c>).</param>
    public ActiveFilterChipsViewModel(ILocalizer localizer, IFilterChipAnnouncer announcer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(announcer);
        _localizer = localizer;
        _announcer = announcer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the overflow popover open-state flips, so the view can show/hide its flyout.</summary>
    public event EventHandler? OverflowOpenChanged;

    /// <summary>The current filters, in render order (web <c>filters</c>).</summary>
    public IReadOnlyList<FilterChipDescriptor> Filters => _filters;

    /// <summary>The number of active filters (web <c>filters.length</c>).</summary>
    public int Count => _filters.Count;

    /// <summary>Whether there are no active filters (web <c>isEmpty = filters.length === 0</c>).</summary>
    public bool IsEmpty => _filters.Count == 0;

    /// <summary>
    /// Whether the surface renders at all — false only when there is nothing to show and
    /// <see cref="HideWhenEmpty"/> is set (web <c>hideWhenEmpty &amp;&amp; isEmpty</c> → <c>return null</c>).
    /// </summary>
    public bool IsRendered => !(_hideWhenEmpty && IsEmpty);

    /// <summary>The page-owned clear-all callback (web <c>onClearAll?</c>); when null the affordance is not rendered.</summary>
    public Action? OnClearAll
    {
        get => _onClearAll;
        set
        {
            if (_onClearAll == value)
            {
                return;
            }

            _onClearAll = value;
            RaiseAll();
        }
    }

    /// <summary>Whether a clear-all callback was supplied (web <c>onClearAll</c> truthiness).</summary>
    public bool HasClearAll => _onClearAll is not null;

    /// <summary>Whether the clear-all affordance is shown (web <c>onClearAll &amp;&amp; filters.length > 0</c>).</summary>
    public bool ShowClearAll => HasClearAll && _filters.Count > 0;

    /// <summary>The inline chip cap (web <c>maxVisible</c>, default 8); setting it re-partitions the chips.</summary>
    public int MaxVisible
    {
        get => _maxVisible;
        set
        {
            if (_maxVisible == value)
            {
                return;
            }

            _maxVisible = value;
            InvalidatePartition();
            RaiseAll();
        }
    }

    /// <summary>When true (default) the surface renders nothing while empty (web <c>hideWhenEmpty</c>).</summary>
    public bool HideWhenEmpty
    {
        get => _hideWhenEmpty;
        set
        {
            if (_hideWhenEmpty == value)
            {
                return;
            }

            _hideWhenEmpty = value;
            RaiseAll();
        }
    }

    /// <summary>Whether the overflow popover is open (web <c>overflowOpen</c>).</summary>
    public bool OverflowOpen
    {
        get => _overflowOpen;
        set
        {
            if (_overflowOpen == value)
            {
                return;
            }

            _overflowOpen = value;
            RaiseAll();
            OverflowOpenChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    /// <summary>The chips rendered inline (web <c>visible</c>).</summary>
    public IReadOnlyList<FilterChipDescriptor> Visible
    {
        get
        {
            EnsurePartition();
            return _visibleCache!;
        }
    }

    /// <summary>The chips collapsed behind the "+N more" trigger (web <c>overflow</c>).</summary>
    public IReadOnlyList<FilterChipDescriptor> Overflow
    {
        get
        {
            EnsurePartition();
            return _overflowCache!;
        }
    }

    /// <summary>Whether an overflow bucket exists (web <c>overflow.length > 0</c>).</summary>
    public bool HasOverflow => Overflow.Count > 0;

    /// <summary>The chip-group accessible name (web <c>aria-label={t('filters.activeLabel', ...)}</c>).</summary>
    public string ActiveLabel =>
        _localizer.GetString(ActiveFilterChipsRegistration.ActiveLabelKey, ActiveFilterChipsRegistration.ActiveLabelFallback);

    /// <summary>The clear-all button label (web <c>t('filters.clearAll', 'Clear all')</c>).</summary>
    public string ClearAllLabel =>
        _localizer.GetString(ActiveFilterChipsRegistration.ClearAllKey, ActiveFilterChipsRegistration.ClearAllFallback);

    /// <summary>The overflow popover accessible name (web <c>aria-label={t('filters.moreLabel', ...)}</c>).</summary>
    public string MoreLabel =>
        _localizer.GetString(ActiveFilterChipsRegistration.MoreLabelKey, ActiveFilterChipsRegistration.MoreLabelFallback);

    /// <summary>The "+N more" trigger label with the overflow count interpolated (web <c>t('filters.moreCount', { count })</c>).</summary>
    public string MoreCountLabel => ActiveFilterChipsRegistration.FormatMoreCount(
        _localizer.GetString(ActiveFilterChipsRegistration.MoreCountKey, ActiveFilterChipsRegistration.MoreCountFallback),
        Overflow.Count);

    /// <summary>The accessible name of a chip's remove button (web <c>t('filters.removeAria', { label })</c>).</summary>
    public string RemoveAriaFor(FilterChipDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        return ActiveFilterChipsRegistration.FormatRemoveAria(
            _localizer.GetString(ActiveFilterChipsRegistration.RemoveAriaKey, ActiveFilterChipsRegistration.RemoveAriaFallback),
            descriptor.Label);
    }

    /// <summary>Replace the current filters, re-partitioning the chips (web <c>filters</c> prop change).</summary>
    public void SetFilters(IReadOnlyList<FilterChipDescriptor> filters)
    {
        ArgumentNullException.ThrowIfNull(filters);
        _filters = filters;
        InvalidatePartition();

        // web effect: when filters drop to zero, also collapse the overflow popover.
        if (_filters.Count == 0 && _overflowOpen)
        {
            _overflowOpen = false;
            OverflowOpenChanged?.Invoke(this, EventArgs.Empty);
        }

        RaiseAll();
    }

    /// <summary>Toggle the overflow popover (web <c>setOverflowOpen((v) =&gt; !v)</c>).</summary>
    public void ToggleOverflow() => OverflowOpen = !_overflowOpen;

    /// <summary>
    /// Remove a chip — the web <c>handleRemove</c>: announce the removal politely (with the rotating zero-width
    /// suffix) and then invoke the descriptor's page-owned <see cref="FilterChipDescriptor.OnRemove"/> callback.
    /// </summary>
    public void Remove(FilterChipDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        AnnounceRemoval(descriptor);
        descriptor.OnRemove();
    }

    /// <summary>
    /// Request a clear of all filters — the web <c>handleClearAll</c>: no-op when no callback is supplied;
    /// otherwise announce "All filters cleared" politely (with the rotating zero-width suffix) and invoke the
    /// page-owned <see cref="OnClearAll"/> callback.
    /// </summary>
    public void RequestClearAll()
    {
        if (_onClearAll is null)
        {
            return;
        }

        AnnounceClearedAll();
        _onClearAll();
    }

    private void EnsurePartition()
    {
        if (_visibleCache is not null)
        {
            return;
        }

        // web useMemo: maxVisible <= 0 -> everything overflows; filters <= cap -> everything inline; otherwise
        // reserve one slot for the "+N more" trigger (cap - 1 inline) and overflow the remainder.
        if (_maxVisible <= 0)
        {
            _visibleCache = Empty;
            _overflowCache = _filters;
            return;
        }

        if (_filters.Count <= _maxVisible)
        {
            _visibleCache = _filters;
            _overflowCache = Empty;
            return;
        }

        int visibleCount = Math.Max(0, _maxVisible - 1);
        var visible = new FilterChipDescriptor[visibleCount];
        for (int i = 0; i < visibleCount; i++)
        {
            visible[i] = _filters[i];
        }

        var overflow = new FilterChipDescriptor[_filters.Count - visibleCount];
        for (int i = visibleCount; i < _filters.Count; i++)
        {
            overflow[i - visibleCount] = _filters[i];
        }

        _visibleCache = visible;
        _overflowCache = overflow;
    }

    private void InvalidatePartition()
    {
        _visibleCache = null;
        _overflowCache = null;
    }

    private void AnnounceRemoval(FilterChipDescriptor descriptor)
    {
        string removed = _localizer.GetString(
            ActiveFilterChipsRegistration.RemovedKey,
            ActiveFilterChipsRegistration.RemovedFallback);
        _announcer.Announce(ActiveFilterChipsRegistration.ComposeRemoval(removed, descriptor.Label) + NextPadding());
    }

    private void AnnounceClearedAll()
    {
        string cleared = _localizer.GetString(
            ActiveFilterChipsRegistration.ClearedAllKey,
            ActiveFilterChipsRegistration.ClearedAllFallback);
        _announcer.Announce(cleared + NextPadding());
    }

    private string NextPadding()
    {
        // web: announceCounterRef.current += 1; padding = '\u200B'.repeat(counter % 4) — a fresh string forces
        // assistive technology to re-announce an otherwise-identical message.
        _announceCounter++;
        return new string('\u200B', _announceCounter % 4);
    }

    private void RaiseAll() => PropertyChanged?.Invoke(this, AllProperties);
}
