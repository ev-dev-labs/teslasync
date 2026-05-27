// Package service contains business logic services that sit between
// HTTP handlers (or the background worker) and the data-access layer
// (database repositories). By centralising domain rules here, handlers
// remain thin HTTP-to-JSON translators and the worker stays focused on
// scheduling, while shared logic like session tracking, vehicle state
// assembly, and energy calculations live in one testable place.
// Layer: platform
package service
