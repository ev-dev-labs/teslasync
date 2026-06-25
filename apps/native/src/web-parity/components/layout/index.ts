// Native parity port of web/src/components/layout/index.ts.
// This barrel preserves the web layout public API surface while the individual
// layout modules are ported to React Native one file at a time. Only modules
// that already have a native parity implementation are actively re-exported;
// every other web export is recorded below as a forward declaration so the
// intended surface stays visible and is trivially enabled when its dedicated
// native module lands. Re-exporting a not-yet-ported module would break
// `tsc --noEmit`, so the deferred set is documented via
// nativeLayoutBarrelCapabilities instead.

// --- Pending native ports --------------------------------------------------
// The web exports below have no native parity module yet (the
// web-parity/components/layout directory currently contains only this barrel).
// They are intentionally left as forward declarations (commented out, not
// active re-exports) because importing from a missing module would fail
// typecheck. Each line mirrors the exact web export so the public surface is
// preserved for the next conversion pass; uncomment a line once its source
// module is ported to native.
//
// export {PageContainer} from './PageContainer';
// export {PageHeader} from './PageHeader';
// export {PageHeaderSticky, type PageHeaderStickyProps} from './PageHeaderSticky';
// export {Breadcrumbs, type BreadcrumbItem} from './Breadcrumbs';
// export {Stack} from './Stack';
// export {Grid} from './Grid';
// export {CopyLinkButton} from './CopyLinkButton';
// export {PrefetchLink, type PrefetchLinkProps} from './PrefetchLink';
// export {VehiclePicker, type VehiclePickerProps} from './VehiclePicker';
// export {
//   StatusBar,
//   useStatusBarPrefs,
//   setStatusBarPrefs,
//   type StatusBarProps,
//   type StatusBarPrefs,
// } from './StatusBar';

export const nativeLayoutBarrelCapabilities = {
  ported: [],
  pending: [
    'PageContainer',
    'PageHeader',
    'PageHeaderSticky',
    'Breadcrumbs',
    'Stack',
    'Grid',
    'CopyLinkButton',
    'PrefetchLink',
    'VehiclePicker',
    'StatusBar',
  ],
  reason:
    'Native layout modules are converted one file at a time; no layout module has a native parity implementation yet, so every web export is forward-declared in the barrel instead of re-exported to keep `tsc --noEmit` green.',
} as const;
