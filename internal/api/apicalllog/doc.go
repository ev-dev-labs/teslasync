// Package apicalllog serves read endpoints over the api_call_log hypertable.
//
// Writes stay in the parent package middleware because it owns the chi chain;
// this subpackage only exposes list and stats views for the observability UI.
//
// Layer: handler
package apicalllog
