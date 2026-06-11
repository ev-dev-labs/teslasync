//
//  VehiclePhotoGallery.Adapter.swift
//  TeslaSync — P4 feature view · 0306 · VehiclePhotoGallery (Apple)
//
//  The testable, dependency-free core for the vehicle-photo gallery — the SwiftUI parity of
//  features/vehicles/components/VehiclePhotoGallery.tsx. Everything here is pure (no store,
//  no bundle, no rendered view, no networking) so the normalized image record (the web
//  `LightboxImage`: `src` / `alt` / `caption`, widened with the rendered bytes the seam
//  resolves), the responsive column ladder (web `grid-cols-2 sm:grid-cols-3 md:grid-cols-4`),
//  and the accessible-label builders (the grid's named/unnamed aria-label, the per-thumbnail
//  "Open photo {{index}} of {{total}}", the viewer counter) are all unit tested in isolation.
//
//  Parity note: the web component is a display-only wrapper around the shared `<Lightbox>`.
//  It takes a `photos` array, renders a square thumbnail grid (or an empty-state card when
//  the array is empty), and opens the lightbox at the tapped index. This core reproduces the
//  data shape + the label/layout derivations; the chrome lives in the view layer and the
//  immersive viewer composes the shared `tsLightbox` presentation.
//

import Foundation

// MARK: - Image record (web `LightboxImage`)

/// One gallery image — the native mirror of the web `LightboxImage` the gallery feeds into
/// `<Lightbox>`. `id` carries the web `src` (the stable identity + cache key), `alt` the
/// accessible description, `caption` the optional lightbox caption, and `data` the rendered
/// bytes fetched behind the P1/S8 seam (web `<img src>`), so the view performs no networking.
public struct PhotoGalleryImage: Identifiable, Equatable, Sendable {
    /// Web `src` — the image URL/identity, reused as the cache-stable list id.
    public let id: String
    /// Web `alt` — the accessible image description (may be empty for decorative images).
    public let alt: String
    /// Web `caption` — the optional caption rendered under the lightbox image.
    public let caption: String?
    /// The decoded photo bytes resolved behind the seam (web `<img>` fetch). `nil` while the
    /// bytes are still arriving, so the thumbnail shows pending chrome rather than a blank box.
    public let data: Data?

    public init(id: String, alt: String, caption: String? = nil, data: Data? = nil) {
        self.id = id
        self.alt = alt
        self.caption = caption
        self.data = data
    }
}

// MARK: - Responsive columns (web `grid-cols-2 sm:grid-cols-3 md:grid-cols-4`)

/// The responsive thumbnail-grid column ladder — the native port of the web Tailwind grid
/// (`grid-cols-2` base, `sm:grid-cols-3` ≥ 640 pt, `md:grid-cols-4` ≥ 768 pt). Pure +
/// width-driven so the same breakpoints drive iPhone, iPad, and Mac window sizes, and the
/// mapping is unit tested at each boundary.
public enum PhotoGalleryLayout {
    /// Tailwind `sm` breakpoint — three columns at/above this width.
    public static let smallBreakpoint: CGFloat = 640
    /// Tailwind `md` breakpoint — four columns at/above this width.
    public static let mediumBreakpoint: CGFloat = 768

    /// Resolves the column count for a container width (web 2 / 3 / 4 ladder).
    public static func columnCount(forWidth width: CGFloat) -> Int {
        if width >= mediumBreakpoint { return 4 }
        if width >= smallBreakpoint { return 3 }
        return 2
    }
}

// MARK: - Accessible labels (web `aria-label` builders)

/// Pure builders for the gallery's accessible labels — the native port of the web `t(...)`
/// calls that compose the grid label (named vs unnamed), the per-thumbnail open label, and
/// the immersive-viewer counter. Each returns a key/fallback pair or performs the `{{token}}`
/// substitution the web `t(key, { ... })` interpolation does, so the view resolves copy
/// through the P1/S10 facade and the substitution is asserted without a rendering host.
public enum PhotoGalleryAccessibility {
    /// The grid's aria-label descriptor — web `vehicleName ? '{{name}} photo gallery' :
    /// 'Photo gallery'`. The named variant still needs `{{name}}` substituted by the caller.
    public static func galleryLabel(hasVehicleName: Bool) -> (key: String, fallback: String) {
        hasVehicleName
            ? ("vehicles.photos.galleryNamed", "{{name}} photo gallery")
            : ("vehicles.photos.gallery", "Photo gallery")
    }

    /// Substitutes the `{{name}}` token in the resolved gallery template (web `{ name }`).
    public static func interpolateName(_ template: String, name: String) -> String {
        template.replacingOccurrences(of: "{{name}}", with: name)
    }

    /// Substitutes the `{{index}}` + `{{total}}` tokens shared by the per-thumbnail open
    /// label (web `'Open photo {{index}} of {{total}}'`, 1-based index) and the viewer
    /// counter (`'{{index}} of {{total}}'`).
    public static func interpolatePosition(_ template: String, index: Int, total: Int) -> String {
        template
            .replacingOccurrences(of: "{{index}}", with: String(index))
            .replacingOccurrences(of: "{{total}}", with: String(total))
    }
}
