//
//  LayoutBreadcrumbs.Projection.swift
//  TeslaSync — P4 shared surface · 0170 · LayoutBreadcrumbs (Apple)
//
//  The pure projection from the cached coordination state (the current route + the merged override map)
//  to the resolved, view-ready trail — the native port of what `useBreadcrumbs(useBreadcrumbOverrides())`
//  returns and what `<Breadcrumbs>` renders. This is the surface's data adapter in the "cached →
//  projection" sense the acceptance calls for: it takes the cached pathname (from the route seam) plus the
//  merged overrides (from the sibling `BreadcrumbOverridesState`) and runs them through the shared
//  ``BreadcrumbOverridesProjection`` over this surface's route catalog. The view is a pure function of the
//  resulting ``BreadcrumbOverridesTrailResolved``; every branch (rendered / suppressed / empty) is unit
//  tested.
//

import Foundation

// MARK: - LayoutBreadcrumbsProjection (web useBreadcrumbs + Breadcrumbs suppression)

/// Pure projection from the current route + merged overrides to the resolved trail. It delegates to the
/// shared ``BreadcrumbOverridesProjection`` (the sibling P4/0166 port of `useBreadcrumbs`) over this
/// surface's ``LayoutBreadcrumbsRouteCatalog`` so the matching / parent-walk / label-resolution logic
/// stays single-sourced (DRY); this surface contributes only the catalog + the live route binding.
public enum LayoutBreadcrumbsProjection {
    /// Projects the route table + current path + merged overrides into the resolved trail — web
    /// `useBreadcrumbs(useBreadcrumbOverrides())` + `<Breadcrumbs>` self-suppression. Defaults bind the
    /// production catalog + the app-catalog route localizer; tests pass explicit values for determinism.
    public static func resolve(
        table: BreadcrumbOverridesRouteTable = LayoutBreadcrumbsRouteCatalog.table,
        path: String,
        overrides: BreadcrumbOverrideMap,
        localize: BreadcrumbOverridesLocalize = LayoutBreadcrumbsStrings.routeLabel
    ) -> BreadcrumbOverridesTrailResolved {
        BreadcrumbOverridesProjection.resolve(
            table: table,
            path: path,
            overrides: overrides,
            localize: localize
        )
    }
}
