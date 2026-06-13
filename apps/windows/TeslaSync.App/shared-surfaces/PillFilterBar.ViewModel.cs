using System.Collections.Generic;
using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="PillFilterBar"/> view — the native port of the web
/// component body (<c>web/src/components/forms/PillFilterBar.tsx</c>). It owns the injected <see cref="Items"/>,
/// the controlled <see cref="ActiveKey"/>, the <see cref="Variant"/> / <see cref="Scrollable"/> render flags and
/// the assistive <see cref="AriaLabel"/>, and it reproduces the web logic exactly: a single-select tablist whose
/// selection is reported through the page-owned <see cref="OnChange"/> callback (web <c>onChange</c>); the WAI-ARIA
/// Tabs keyboard model where Left/Right wrap around the <see cref="EnabledKeys"/> and Home/End jump to the first /
/// last enabled pill (web <c>handleKeyDown</c>, skipping <see cref="PillItemDescriptor.Disabled"/> pills); and the
/// defensive empty branch (<see cref="PillFilterBarState.Empty"/>) when no items are supplied. The view binds the
/// projected state and never performs I/O. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class PillFilterBarViewModel : INotifyPropertyChanged
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);
    private static readonly IReadOnlyList<PillItemDescriptor> EmptyItems = Array.Empty<PillItemDescriptor>();
    private static readonly IReadOnlyList<string> EmptyKeys = Array.Empty<string>();

    private IReadOnlyList<PillItemDescriptor> _items = EmptyItems;
    private IReadOnlyList<string>? _enabledKeysCache;
    private string _activeKey = string.Empty;
    private string _ariaLabel = string.Empty;
    private PillFilterBarVariant _variant = PillFilterBarRegistration.DefaultVariant;
    private bool _scrollable = PillFilterBarRegistration.DefaultScrollable;
    private Action<string>? _onChange;

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The pills, in render order (web <c>items</c>).</summary>
    public IReadOnlyList<PillItemDescriptor> Items => _items;

    /// <summary>The number of pills (web <c>items.length</c>).</summary>
    public int Count => _items.Count;

    /// <summary>Whether there are no pills (web empty <c>items</c> array).</summary>
    public bool IsEmpty => _items.Count == 0;

    /// <summary>The content state — <see cref="PillFilterBarState.Empty"/> only when there are no pills.</summary>
    public PillFilterBarState State => IsEmpty ? PillFilterBarState.Empty : PillFilterBarState.Ready;

    /// <summary>The keys of the non-disabled pills, in render order (web <c>enabledKeys</c>).</summary>
    public IReadOnlyList<string> EnabledKeys
    {
        get
        {
            if (_enabledKeysCache is not null)
            {
                return _enabledKeysCache;
            }

            if (_items.Count == 0)
            {
                _enabledKeysCache = EmptyKeys;
                return _enabledKeysCache;
            }

            var keys = new List<string>(_items.Count);
            foreach (PillItemDescriptor item in _items)
            {
                if (!item.Disabled)
                {
                    keys.Add(item.Key);
                }
            }

            _enabledKeysCache = keys;
            return _enabledKeysCache;
        }
    }

    /// <summary>
    /// The currently-selected key (web controlled <c>activeKey</c>). Setting it reflects the host's controlled
    /// state and updates the selection visuals; it does NOT fire <see cref="OnChange"/> (a programmatic set is not
    /// a user gesture). User gestures flow through <see cref="RequestSelect"/>.
    /// </summary>
    public string ActiveKey
    {
        get => _activeKey;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_activeKey, next, StringComparison.Ordinal))
            {
                return;
            }

            _activeKey = next;
            RaiseAll();
        }
    }

    /// <summary>The assistive name announced for the tablist (web <c>aria-label={ariaLabel}</c>); caller-supplied, already localized.</summary>
    public string AriaLabel
    {
        get => _ariaLabel;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_ariaLabel, next, StringComparison.Ordinal))
            {
                return;
            }

            _ariaLabel = next;
            RaiseAll();
        }
    }

    /// <summary>The render style (web <c>variant</c>); defaults to <see cref="PillFilterBarVariant.Pills"/>.</summary>
    public PillFilterBarVariant Variant
    {
        get => _variant;
        set
        {
            if (_variant == value)
            {
                return;
            }

            _variant = value;
            RaiseAll();
        }
    }

    /// <summary>Whether the bar scrolls horizontally on overflow (web <c>scrollable</c>); defaults to true.</summary>
    public bool Scrollable
    {
        get => _scrollable;
        set
        {
            if (_scrollable == value)
            {
                return;
            }

            _scrollable = value;
            RaiseAll();
        }
    }

    /// <summary>The page-owned selection callback (web <c>onChange</c>); invoked by every user gesture through <see cref="RequestSelect"/>.</summary>
    public Action<string>? OnChange
    {
        get => _onChange;
        set
        {
            if (_onChange == value)
            {
                return;
            }

            _onChange = value;
            RaiseAll();
        }
    }

    /// <summary>The descriptor matching <see cref="ActiveKey"/>, or null when nothing matches.</summary>
    public PillItemDescriptor? SelectedItem
    {
        get
        {
            foreach (PillItemDescriptor item in _items)
            {
                if (string.Equals(item.Key, _activeKey, StringComparison.Ordinal))
                {
                    return item;
                }
            }

            return null;
        }
    }

    /// <summary>Whether a pill matching <see cref="ActiveKey"/> is present (web <c>selected</c> exists for some item).</summary>
    public bool HasSelection => SelectedItem is not null;

    /// <summary>Replace the pills, re-partitioning the enabled set (web <c>items</c> prop change).</summary>
    /// <param name="items">The pills, in render order.</param>
    public void SetItems(IReadOnlyList<PillItemDescriptor> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        _items = items;
        _enabledKeysCache = null;
        RaiseAll();
    }

    /// <summary>Whether <paramref name="key"/> is the active pill (web <c>activeKey === item.key</c>).</summary>
    /// <param name="key">The pill key to test.</param>
    public bool IsSelected(string key) => string.Equals(_activeKey, key, StringComparison.Ordinal);

    /// <summary>Whether <paramref name="key"/> belongs to a present, non-disabled pill (web membership of <c>enabledKeys</c>).</summary>
    /// <param name="key">The pill key to test.</param>
    public bool IsEnabled(string key)
    {
        if (string.IsNullOrEmpty(key))
        {
            return false;
        }

        foreach (PillItemDescriptor item in _items)
        {
            if (string.Equals(item.Key, key, StringComparison.Ordinal))
            {
                return !item.Disabled;
            }
        }

        return false;
    }

    /// <summary>
    /// Handle a user gesture selecting <paramref name="key"/> — the web click handler (<c>onClick={() =>
    /// onChange(item.key)}</c>) and the keyboard <c>moveFocus</c> target. A no-op for a disabled / absent pill
    /// (web disabled pills carry the <c>disabled</c> attribute and are skipped by <c>enabledKeys</c>). Otherwise it
    /// updates <see cref="ActiveKey"/> and invokes the page-owned <see cref="OnChange"/> callback with the key
    /// (web always calls <c>onChange</c>, even when re-selecting the active pill).
    /// </summary>
    /// <param name="key">The pill key the user activated.</param>
    /// <returns>True when <see cref="ActiveKey"/> actually changed; false when it was a no-op or a re-selection.</returns>
    public bool RequestSelect(string key)
    {
        if (!IsEnabled(key))
        {
            return false;
        }

        bool changed = !string.Equals(_activeKey, key, StringComparison.Ordinal);
        _activeKey = key;
        if (changed)
        {
            RaiseAll();
        }

        _onChange?.Invoke(key);
        return changed;
    }

    /// <summary>
    /// The next enabled key after <paramref name="fromKey"/>, wrapping past the end (web ArrowRight:
    /// <c>(idx + 1 + len) % len</c>). Returns null when there are no enabled pills or <paramref name="fromKey"/> is
    /// not itself enabled (web <c>indexOf === -1 ? return</c>).
    /// </summary>
    /// <param name="fromKey">The currently-focused pill key.</param>
    public string? NextEnabledKey(string fromKey) => Step(fromKey, +1);

    /// <summary>
    /// The previous enabled key before <paramref name="fromKey"/>, wrapping past the start (web ArrowLeft:
    /// <c>(idx - 1 + len) % len</c>). Returns null when there are no enabled pills or <paramref name="fromKey"/> is
    /// not itself enabled.
    /// </summary>
    /// <param name="fromKey">The currently-focused pill key.</param>
    public string? PreviousEnabledKey(string fromKey) => Step(fromKey, -1);

    /// <summary>The first enabled key (web Home: <c>enabledKeys[0]</c>), or null when none are enabled.</summary>
    public string? FirstEnabledKey
    {
        get
        {
            IReadOnlyList<string> enabled = EnabledKeys;
            return enabled.Count == 0 ? null : enabled[0];
        }
    }

    /// <summary>The last enabled key (web End: <c>enabledKeys[length - 1]</c>), or null when none are enabled.</summary>
    public string? LastEnabledKey
    {
        get
        {
            IReadOnlyList<string> enabled = EnabledKeys;
            return enabled.Count == 0 ? null : enabled[enabled.Count - 1];
        }
    }

    private string? Step(string fromKey, int delta)
    {
        IReadOnlyList<string> enabled = EnabledKeys;
        int len = enabled.Count;
        if (len == 0)
        {
            return null;
        }

        int idx = IndexOf(enabled, fromKey);
        if (idx < 0)
        {
            return null;
        }

        int nextIdx = ((idx + delta) % len + len) % len;
        return enabled[nextIdx];
    }

    private static int IndexOf(IReadOnlyList<string> keys, string key)
    {
        for (int i = 0; i < keys.Count; i++)
        {
            if (string.Equals(keys[i], key, StringComparison.Ordinal))
            {
                return i;
            }
        }

        return -1;
    }

    private void RaiseAll() => PropertyChanged?.Invoke(this, AllProperties);
}
