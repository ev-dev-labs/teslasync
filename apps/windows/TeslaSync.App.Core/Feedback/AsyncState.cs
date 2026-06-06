using System.ComponentModel;

namespace TeslaSync.App.Core.Feedback;

/// <summary>
/// The mutually-exclusive view a data-driven surface can be in. Mirrors the
/// web loading / empty / error / loaded contract that every page renders via
/// <c>Spinner</c>, <c>EmptyState</c>, <c>ErrorDisplay</c> and content.
/// </summary>
public enum LoadStatus
{
    /// <summary>No load has been requested yet.</summary>
    Idle,

    /// <summary>A load is in flight; show a spinner / skeleton.</summary>
    Loading,

    /// <summary>Loaded with content to render.</summary>
    Loaded,

    /// <summary>Loaded successfully but the result is empty; show an empty state.</summary>
    Empty,

    /// <summary>The load failed; show an error state with a retry affordance.</summary>
    Error,
}

/// <summary>
/// UI-thread-free async-data state machine backing the feedback controls
/// (<c>TsEmptyState</c>, <c>TsErrorDisplay</c>, <c>TsQueryError</c>, and every
/// page region). Owns the loading / loaded / empty / error transitions, the
/// retry attempt count and the retry signal so the WinUI control is a thin view
/// that simply swaps which child is visible and wires <see cref="RetryRequested"/>
/// to the real reload.
/// </summary>
/// <typeparam name="T">The loaded payload type.</typeparam>
public sealed class AsyncState<T> : INotifyPropertyChanged
{
    private LoadStatus _status = LoadStatus.Idle;
    private T? _data;
    private string? _errorMessage;
    private int _attempts;

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when <see cref="Retry"/> is invoked so the view can reload.</summary>
    public event EventHandler? RetryRequested;

    /// <summary>Current state.</summary>
    public LoadStatus Status
    {
        get => _status;
        private set
        {
            if (_status == value)
            {
                return;
            }

            _status = value;
            Raise(nameof(Status));
            RaiseDerived();
        }
    }

    /// <summary>The loaded payload; <c>default</c> until a successful load.</summary>
    public T? Data
    {
        get => _data;
        private set
        {
            _data = value;
            Raise(nameof(Data));
        }
    }

    /// <summary>Localized error message shown in the error state.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set
        {
            if (_errorMessage == value)
            {
                return;
            }

            _errorMessage = value;
            Raise(nameof(ErrorMessage));
        }
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set
        {
            if (_attempts == value)
            {
                return;
            }

            _attempts = value;
            Raise(nameof(Attempts));
        }
    }

    /// <summary>True while a load is in flight.</summary>
    public bool IsLoading => _status == LoadStatus.Loading;

    /// <summary>True when loaded with renderable content.</summary>
    public bool HasData => _status == LoadStatus.Loaded;

    /// <summary>True when a successful load returned nothing.</summary>
    public bool IsEmpty => _status == LoadStatus.Empty;

    /// <summary>True when the last load failed.</summary>
    public bool HasError => _status == LoadStatus.Error;

    /// <summary>Whether a retry is currently allowed (only from the error state).</summary>
    public bool CanRetry => _status == LoadStatus.Error;

    /// <summary>Transition to <see cref="LoadStatus.Loading"/> and count the attempt.</summary>
    public void SetLoading()
    {
        ErrorMessage = null;
        Attempts++;
        Status = LoadStatus.Loading;
    }

    /// <summary>
    /// Record a successful load. When <paramref name="isEmpty"/> reports the
    /// payload is empty the state becomes <see cref="LoadStatus.Empty"/>,
    /// otherwise <see cref="LoadStatus.Loaded"/>.
    /// </summary>
    public void SetLoaded(T data, Func<T, bool>? isEmpty = null)
    {
        Data = data;
        ErrorMessage = null;
        Status = isEmpty is not null && isEmpty(data) ? LoadStatus.Empty : LoadStatus.Loaded;
    }

    /// <summary>Force the empty state (e.g. a known-empty result).</summary>
    public void SetEmpty()
    {
        ErrorMessage = null;
        Status = LoadStatus.Empty;
    }

    /// <summary>Record a load failure with a localized message.</summary>
    public void SetError(string message)
    {
        ErrorMessage = message;
        Status = LoadStatus.Error;
    }

    /// <summary>Reset back to <see cref="LoadStatus.Idle"/> and drop any payload / error.</summary>
    public void Reset()
    {
        Data = default;
        ErrorMessage = null;
        Attempts = 0;
        Status = LoadStatus.Idle;
    }

    /// <summary>
    /// Request a retry. Only valid from the error state; transitions back to
    /// loading and raises <see cref="RetryRequested"/> so the view reloads.
    /// </summary>
    public void Retry()
    {
        if (!CanRetry)
        {
            throw new InvalidOperationException("Retry is only valid from the Error state.");
        }

        SetLoading();
        RetryRequested?.Invoke(this, EventArgs.Empty);
    }

    private void RaiseDerived()
    {
        Raise(nameof(IsLoading));
        Raise(nameof(HasData));
        Raise(nameof(IsEmpty));
        Raise(nameof(HasError));
        Raise(nameof(CanRetry));
    }

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
