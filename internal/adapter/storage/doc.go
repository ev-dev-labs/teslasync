// Package storage implements blob/object storage adapters for S3, Azure, and local filesystems.
//
// Layer: adapter
// Layering: implements storage interfaces; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package storage
