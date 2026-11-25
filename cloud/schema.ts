import { sqliteTable, text, integer, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const menus = sqliteTable("menu", {
  id: integer().primaryKey(), name: text().notNull(), description: text().notNull(),
  kind: text().notNull(), base_price: integer().notNull(), is_sold_out: integer().notNull().default(0),
  choice_groups: text().notNull().default("[]"),
  category: text().notNull().default("burger"), photo_key: text(), registration_key: text().unique(),
  version: integer().notNull().default(0)
});
export const options = sqliteTable("menu_option", {
  id: integer().primaryKey(), menu_id: integer().notNull().references(() => menus.id),
  name: text().notNull(), extra_price: integer().notNull(), active: integer().notNull().default(1)
});
export const orders = sqliteTable("orders", {
  id: text().primaryKey(), customer: text().notNull(), signature: text().notNull(),
  total: integer().notNull(), status: text().notNull().default("PENDING_PAYMENT"),
  number: integer().unique(), created_at: text().notNull().default(sql`CURRENT_TIMESTAMP`), cancelled_at: text(),
  cancelled_by: text(), cancel_reason: text(), dining_type: text(), restock_on_cancel: integer(),
  creation_tag: text().notNull()
});
export const items = sqliteTable("order_item", {
  id: text().primaryKey(), order_id: text().notNull().references(() => orders.id),
  menu_id: integer().notNull().references(() => menus.id), name: text().notNull(),
  choice_snapshot: text().notNull().default("[]"),
  quantity: integer().notNull(), price: integer().notNull()
}, t => [index("items_by_order").on(t.order_id)]);
export const choices = sqliteTable("order_item_option", {
  id: text().primaryKey(), item_id: text().notNull().references(() => items.id),
  option_id: integer().notNull().references(() => options.id), name: text().notNull(),
  option_price: integer().notNull()
}, t => [index("options_by_item").on(t.item_id)]);
export const payments = sqliteTable("payment", {
  id: text().primaryKey(), order_id: text().notNull().references(() => orders.id),
  status: text().notNull(), amount: integer().notNull(), mode: text().notNull().default("demo"),
  created_at: text().notNull().default(sql`CURRENT_TIMESTAMP`)
}, t => [index("payments_by_order").on(t.order_id), uniqueIndex("one_success").on(t.order_id).where(sql`status = 'SUCCESS'`)]);
export const sessions = sqliteTable("admin_session", {
  digest: text().primaryKey(), expires: integer().notNull(), auth_revision: integer().notNull().default(0)
});

export const menuDisplayOrder = sqliteTable("menu_display_order", {
  id: integer().primaryKey(), menu_ids: text().notNull().default("[]"),
  revision: integer().notNull().default(0)
});

export const categoryCatalog = sqliteTable('category_catalog', {
  id: integer().primaryKey(), items: text().notNull().default('[]'), revision: integer().notNull().default(0)
});
export const adminAuth = sqliteTable('admin_auth', {
  id: integer().primaryKey(), password_hash: text(), salt: text(), iterations: integer().notNull().default(100000),
  revision: integer().notNull().default(0), recovery_hash: text(), changed_at: text()
});
export const authAttempt = sqliteTable('auth_attempt', {
  key: text().primaryKey(), count: integer().notNull().default(0), expires: integer().notNull()
});
export const adCatalog = sqliteTable('ad_catalog', {
  id: integer().primaryKey(), items: text().notNull().default('[]'), revision: integer().notNull().default(0)
});

export const inventory = sqliteTable('inventory', {
  menu_id: integer().primaryKey().references(() => menus.id), enabled: integer().notNull().default(0),
  quantity: integer().notNull().default(0), low_threshold: integer().notNull().default(5), revision: integer().notNull().default(0)
},t=>[check('inventory_enabled',sql`${t.enabled} IN (0,1)`),check('inventory_quantity',sql`${t.quantity} >= 0`),check('inventory_threshold',sql`${t.low_threshold} >= 0`)]);
export const inventoryMovement = sqliteTable('inventory_movement', {
  id: integer().primaryKey({autoIncrement:true}), menu_id: integer().notNull().references(() => menus.id),
  order_id: text().references(() => orders.id), kind: text().notNull(), delta: integer().notNull(),
  before_quantity: integer().notNull(), after_quantity: integer().notNull(), reason: text().notNull(),
  created_at: text().notNull().default(sql`CURRENT_TIMESTAMP`)
},t=>[uniqueIndex('inventory_order_movement').on(t.order_id,t.menu_id,t.kind)]);
