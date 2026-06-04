// Package chatbot hosts persistence + transport DTOs for the
// AI chatbot bounded context: individual chat messages and per-session
// metadata for the chat sidebar.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// ADR-011 §3 recommends the caller alias `chatbotmodel` when importing
// alongside other model subpackages.
package chatbot
