BEGIN;

ALTER TABLE pinned_items DROP CONSTRAINT pinned_items_item_type_check;
ALTER TABLE pinned_items ADD CONSTRAINT pinned_items_item_type_check
  CHECK (item_type IN (
    'vehicle','widget','alert_rule','location','geofence','automation','dashboard','command','navigation'
  )) NOT VALID;
ALTER TABLE pinned_items VALIDATE CONSTRAINT pinned_items_item_type_check;

COMMIT;
