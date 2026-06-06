using System.Runtime.InteropServices;
using Microsoft.Windows.Widgets.Providers;
using WinRT;

namespace TeslaSync.App.Widgets;

/// <summary>
/// The classic-COM plumbing that lets the packaged app host a widget-provider out-of-process COM server
/// (P2/W8-0003), following the Microsoft Windows App SDK widgets sample. The Windows widget host
/// launches <c>TeslaSync.App.exe -RegisterProcessAsComServer</c>, the process registers this class
/// factory for the provider CLSID, and the host activates <see cref="TeslaSyncWidgetProvider"/> through
/// it. <see cref="WidgetProviderFactory{T}"/> hands the host a WinRT-marshalled instance of the managed
/// provider via CsWinRT's <see cref="MarshalInspectable{T}"/>.
/// </summary>
internal static class WidgetComInterop
{
    /// <summary>The <c>IClassFactory</c> IID.</summary>
    private const string ClassFactoryIid = "00000001-0000-0000-C000-000000000046";

    /// <summary>The <c>IUnknown</c> IID.</summary>
    internal const string UnknownIid = "00000000-0000-0000-C000-000000000046";

    /// <summary><c>CLSCTX_LOCAL_SERVER</c>.</summary>
    private const uint ClsCtxLocalServer = 0x4;

    /// <summary><c>REGCLS_MULTIPLEUSE</c>.</summary>
    private const uint RegClsMultipleUse = 0x1;

    /// <summary>The minimal <c>IClassFactory</c> contract used to register the provider with COM.</summary>
    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid(ClassFactoryIid)]
    internal interface IClassFactory
    {
        /// <summary>Creates an instance of the registered class for <paramref name="riid"/>.</summary>
        [PreserveSig]
        int CreateInstance(IntPtr outer, ref Guid riid, out IntPtr instance);

        /// <summary>Locks the server in memory (no-op for this provider).</summary>
        [PreserveSig]
        int LockServer([MarshalAs(UnmanagedType.Bool)] bool @lock);
    }

    /// <summary>Registers <paramref name="factory"/> for <paramref name="clsid"/>, returning the revoke cookie.</summary>
    internal static uint RegisterClassObject(Guid clsid, IClassFactory factory)
    {
        int hr = CoRegisterClassObject(clsid, factory, ClsCtxLocalServer, RegClsMultipleUse, out uint cookie);
        if (hr < 0)
        {
            Marshal.ThrowExceptionForHR(hr);
        }

        return cookie;
    }

    /// <summary>Revokes a previously registered class object.</summary>
    internal static void RevokeClassObject(uint cookie) => _ = CoRevokeClassObject(cookie);

    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("ole32.dll")]
    private static extern int CoRegisterClassObject(
        [MarshalAs(UnmanagedType.LPStruct)] Guid rclsid,
        [MarshalAs(UnmanagedType.IUnknown)] object factory,
        uint context,
        uint flags,
        out uint cookie);

    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("ole32.dll")]
    private static extern int CoRevokeClassObject(uint cookie);
}

/// <summary>
/// The <c>IClassFactory</c> that materializes the managed widget provider for the COM host. It accepts
/// the provider IID (or <c>IUnknown</c>) and returns a CsWinRT-marshalled instance; any other interface
/// request is failed with <c>E_NOINTERFACE</c> and aggregation with <c>CLASS_E_NOAGGREGATION</c>.
/// </summary>
/// <typeparam name="T">The widget provider implementation to construct.</typeparam>
internal sealed class WidgetProviderFactory<T> : WidgetComInterop.IClassFactory
    where T : IWidgetProvider, new()
{
    private const int ClassNotAggregatable = -2147221232;
    private const int NoSuchInterface = -2147467262;
    private static readonly Guid UnknownGuid = new(WidgetComInterop.UnknownIid);

    /// <inheritdoc />
    public int CreateInstance(IntPtr outer, ref Guid riid, out IntPtr instance)
    {
        instance = IntPtr.Zero;

        if (outer != IntPtr.Zero)
        {
            Marshal.ThrowExceptionForHR(ClassNotAggregatable);
        }

        if (riid == typeof(T).GUID || riid == UnknownGuid)
        {
            instance = MarshalInspectable<IWidgetProvider>.FromManaged(new T());
        }
        else
        {
            Marshal.ThrowExceptionForHR(NoSuchInterface);
        }

        return 0;
    }

    /// <inheritdoc />
    public int LockServer(bool @lock) => 0;
}
