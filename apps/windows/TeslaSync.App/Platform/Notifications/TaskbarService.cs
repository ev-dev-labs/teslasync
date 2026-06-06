using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using TeslaSync.App.Core.Notifications;
using Windows.Data.Xml.Dom;
using Windows.UI.Notifications;

namespace TeslaSync.App.Notifications;

/// <summary>
/// Applies the reduced <see cref="TaskbarStatus"/> to the Windows taskbar button (P2/W8-0001): the
/// determinate / indeterminate / paused / error progress bar via the shell <c>ITaskbarList3</c>
/// interface, and the numeric overlay badge via the WinRT <see cref="BadgeUpdateManager"/>. It is fed by
/// the <see cref="TaskbarJobTracker"/>, so it only ever reflects real in-flight jobs — there is no demo
/// or fabricated progress. All shell calls are marshalled to the UI thread and wrapped best-effort, so a
/// host without taskbar support (or package identity for the badge) degrades silently.
/// </summary>
public sealed class TaskbarService
{
    private static readonly Guid TaskbarListClsid = new("56FDF344-FD6D-11d0-958A-006097C9A090");

    private readonly nint _windowHandle;
    private readonly DispatcherQueue _dispatcher;
    private readonly NotificationDiagnostics _diagnostics;
    private ITaskbarList3? _taskbar;
    private bool _taskbarTried;

    /// <summary>Creates the service bound to the host window handle and the UI dispatcher.</summary>
    public TaskbarService(nint windowHandle, DispatcherQueue dispatcher, NotificationDiagnostics diagnostics)
    {
        ArgumentNullException.ThrowIfNull(dispatcher);
        ArgumentNullException.ThrowIfNull(diagnostics);

        _windowHandle = windowHandle;
        _dispatcher = dispatcher;
        _diagnostics = diagnostics;
    }

    /// <summary>Applies <paramref name="status"/> to the taskbar (marshalling to the UI thread as needed).</summary>
    public void Apply(TaskbarStatus status)
    {
        ArgumentNullException.ThrowIfNull(status);

        if (_dispatcher.HasThreadAccess)
        {
            ApplyCore(status);
        }
        else
        {
            _dispatcher.TryEnqueue(() => ApplyCore(status));
        }
    }

    private void ApplyCore(TaskbarStatus status)
    {
        try
        {
            ApplyProgress(status);
            ApplyBadge(status.BadgeCount);
            _diagnostics.RecordTaskbarUpdate();
        }
        catch (Exception)
        {
            // The taskbar surface is best-effort; never let a shell hiccup propagate.
        }
    }

    private void ApplyProgress(TaskbarStatus status)
    {
        var taskbar = EnsureTaskbar();
        if (taskbar is null || _windowHandle == 0)
        {
            return;
        }

        taskbar.SetProgressState(_windowHandle, ToFlag(status.State));
        if (status.State is TaskbarProgressState.Normal or TaskbarProgressState.Error or TaskbarProgressState.Paused)
        {
            ulong value = (ulong)Math.Round(Math.Clamp(status.Progress, 0.0, 1.0) * 1000);
            taskbar.SetProgressValue(_windowHandle, value, 1000);
        }
    }

    private static void ApplyBadge(int count)
    {
        var updater = BadgeUpdateManager.CreateBadgeUpdaterForApplication();
        if (count <= 0)
        {
            updater.Clear();
            return;
        }

        var xml = BadgeUpdateManager.GetTemplateContent(BadgeTemplateType.BadgeNumber);
        if (xml.SelectSingleNode("/badge") is XmlElement element)
        {
            element.SetAttribute("value", count.ToString(CultureInfo.InvariantCulture));
            updater.Update(new BadgeNotification(xml));
        }
    }

    private ITaskbarList3? EnsureTaskbar()
    {
        if (_taskbarTried)
        {
            return _taskbar;
        }

        _taskbarTried = true;
        try
        {
            var type = Type.GetTypeFromCLSID(TaskbarListClsid);
            if (type is not null && Activator.CreateInstance(type) is ITaskbarList3 instance)
            {
                instance.HrInit();
                _taskbar = instance;
            }
        }
        catch (Exception)
        {
            _taskbar = null;
        }

        return _taskbar;
    }

    private static TbpFlag ToFlag(TaskbarProgressState state) => state switch
    {
        TaskbarProgressState.Normal => TbpFlag.Normal,
        TaskbarProgressState.Indeterminate => TbpFlag.Indeterminate,
        TaskbarProgressState.Paused => TbpFlag.Paused,
        TaskbarProgressState.Error => TbpFlag.Error,
        _ => TbpFlag.NoProgress,
    };
}

/// <summary>The <c>ITaskbarList3</c> progress-bar flags (shobjidl.h <c>TBPFLAG</c>).</summary>
[Flags]
internal enum TbpFlag
{
    /// <summary>No progress bar.</summary>
    NoProgress = 0,

    /// <summary>Marquee (indeterminate) progress.</summary>
    Indeterminate = 0x1,

    /// <summary>Normal (green) determinate progress.</summary>
    Normal = 0x2,

    /// <summary>Error (red) progress.</summary>
    Error = 0x4,

    /// <summary>Paused (yellow) progress.</summary>
    Paused = 0x8,
}

/// <summary>The shell taskbar progress / overlay interface (subset used for progress reporting).</summary>
[ComImport]
[Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ITaskbarList3
{
    /// <summary>Initializes the taskbar list object.</summary>
    void HrInit();

    /// <summary>Adds a tab for the window.</summary>
    void AddTab(nint hwnd);

    /// <summary>Deletes the tab for the window.</summary>
    void DeleteTab(nint hwnd);

    /// <summary>Activates the tab for the window.</summary>
    void ActivateTab(nint hwnd);

    /// <summary>Marks the window as the active alternate tab.</summary>
    void SetActiveAlt(nint hwnd);

    /// <summary>Marks (or clears) a window as full-screen for the taskbar.</summary>
    void MarkFullscreenWindow(nint hwnd, [MarshalAs(UnmanagedType.Bool)] bool fullscreen);

    /// <summary>Sets the determinate progress value for the window's taskbar button.</summary>
    void SetProgressValue(nint hwnd, ulong completed, ulong total);

    /// <summary>Sets the progress-bar state for the window's taskbar button.</summary>
    void SetProgressState(nint hwnd, TbpFlag flags);
}
