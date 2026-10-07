import type { MaintenanceItem, ServiceRecord } from '../maintenanceModel';

/** Full-contract fixtures, never production records or a fallback data source. */
export function item(overrides: Partial<MaintenanceItem> = {}): MaintenanceItem {
  return {
    id: 1,
    vehicle_id: 7,
    category: 'tires',
    name: 'Rotation',
    description: 'Original service description',
    due_date: null,
    due_mileage: null,
    current_mileage: 0,
    last_service_date: null,
    last_service_mileage: null,
    interval_months: null,
    interval_miles: null,
    status: 'good',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

export function record(overrides: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    id: 11,
    vehicle_id: 7,
    date: '2024-03-01T10:00:00Z',
    description: 'Annual inspection',
    mileage: 23456.789,
    cost: 123.456,
    provider: 'Original service provider',
    notes: 'Evidence note remains verbatim',
    created_at: '2024-03-01T10:00:00Z',
    ...overrides,
  };
}
