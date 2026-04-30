package api

// Analytics request and response DTOs for the AnalyticsHandler currently live
// inline within the methods that own them (e.g. the local vehicleStats and
// batteryPoint structs inside Fleet). This file exists so any future top-level
// analytics DTOs have a dedicated home alongside analytics_handler.go and
// analytics_handler_queries.go without expanding the handler skeleton.
