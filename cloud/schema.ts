import { sqliteTable, text, integer, uniqueIndex, index, check, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const menus = sqliteTable("menu", {
  id: integer().primaryKey(), name: text().notNull(), description: text().notNull(),
  kind: text().notNull(), base_price: integer().notNull(), is_sold_out: integer().notNull().default(0),
  choice_groups: text().notNull().default("[]"),
  category: text().notNull().default("burger"), photo_key: text(), registration_key: text().unique(),
  version: integer().notNull().default(0), store_id: integer().notNull().default(1)
},t=>[index('menu_by_store').on(t.store_id,t.id)]);
export const options = sqliteTable("menu_option", {
  id: integer().primaryKey(), menu_id: integer().notNull().references(() => menus.id),
  name: text().notNull(), extra_price: integer().notNull(), active: integer().notNull().default(1)
});
export const orders = sqliteTable("orders", {
  id: text().primaryKey(), customer: text().notNull(), signature: text().notNull(),
  total: integer().notNull(), status: text().notNull().default("PENDING_PAYMENT"),
  number: integer(), created_at: text().notNull().default(sql`CURRENT_TIMESTAMP`), cancelled_at: text(),
  cancelled_by: text(), cancel_reason: text(), dining_type: text(), restock_on_cancel: integer(),
  creation_tag: text().notNull(), store_id: integer().notNull().default(1)
},t=>[index('orders_by_store').on(t.store_id,t.created_at),uniqueIndex('orders_store_number_unique').on(t.store_id,t.number)]);
export const items = sqliteTable("order_item", {
  id: text().primaryKey(), order_id: text().notNull().references(() => orders.id),
  menu_id: integer().notNull().references(() => menus.id), name: text().notNull(),
  choice_snapshot: text().notNull().default("[]"),
  quantity: integer().notNull(), price: integer().notNull()
  ,regular_price: integer(), promotion: text()
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
export const promotionCatalog = sqliteTable('promotion_catalog', {
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

export const stores = sqliteTable('store', {
 id:integer().primaryKey({autoIncrement:true}),name:text().notNull(),enabled:integer().notNull().default(1),created_at:text().notNull().default(sql`CURRENT_TIMESTAMP`),
 opening_key:text(),opening_signature:text(),opening_tag:text(),template_store_id:integer(),
 address:text(),address_detail:text(),locality:text(),address_pending:integer().notNull().default(0),profile_revision:integer().notNull().default(0)
},t=>[uniqueIndex('store_opening_key_unique').on(t.opening_key)]);
export const menuIdentity=sqliteTable('menu_identity',{
 menu_id:integer().primaryKey().references(()=>menus.id),product_code:text().notNull()
},t=>[index('menu_identity_product').on(t.product_code)]);
export const staffAccounts = sqliteTable('staff_account', {
 uid:text().primaryKey(),email:text().notNull(),platform_role:text().notNull().default('USER'),enabled:integer().notNull().default(1),created_at:text().notNull().default(sql`CURRENT_TIMESTAMP`)
},t=>[check('account_role',sql`${t.platform_role} IN ('USER','HQ')`)]);
export const storeMembers = sqliteTable('store_member', {
 store_id:integer().notNull().references(()=>stores.id),uid:text().notNull().references(()=>staffAccounts.uid),role:text().notNull(),enabled:integer().notNull().default(1),revision:integer().notNull().default(0)
},t=>[primaryKey({columns:[t.store_id,t.uid]}),check('member_role',sql`${t.role} IN ('OWNER','STAFF')`)]);
export const invitations = sqliteTable('store_invitation', {
 id:text().primaryKey(),store_id:integer().notNull().references(()=>stores.id),email:text().notNull(),role:text().notNull(),created_by:text().notNull(),expires:integer().notNull(),accepted_uid:text(),revoked:integer().notNull().default(0),created_at:text().notNull().default(sql`CURRENT_TIMESTAMP`)
},t=>[index('invitations_by_email').on(t.email,t.expires),check('invitation_role',sql`${t.role} IN ('OWNER','STAFF')`)]);
export const accountAudit=sqliteTable('account_audit',{
 id:integer().primaryKey({autoIncrement:true}),store_id:integer(),actor:text().notNull(),action:text().notNull(),target:text().notNull(),created_at:text().notNull().default(sql`CURRENT_TIMESTAMP`)
});
export const accountPolicy=sqliteTable('account_policy',{
 id:integer().primaryKey(),legacy_disabled:integer().notNull().default(0)
});
export const ingredients=sqliteTable('ingredient',{
 id:integer().primaryKey({autoIncrement:true}),registration_key:text().notNull().unique(),name:text().notNull(),unit:text().notNull(),pack_label:text().notNull(),pack_size:integer().notNull(),active:integer().notNull().default(1),revision:integer().notNull().default(0)
},t=>[check('ingredient_pack',sql`${t.pack_size} BETWEEN 1 AND 1000000`),check('ingredient_active',sql`${t.active} IN (0,1)`)]);
export const ingredientStock=sqliteTable('ingredient_stock',{
 store_id:integer().notNull().references(()=>stores.id),ingredient_id:integer().notNull().references(()=>ingredients.id),quantity:integer().notNull().default(0),low_threshold:integer().notNull().default(0),revision:integer().notNull().default(0)
},t=>[primaryKey({columns:[t.store_id,t.ingredient_id]}),check('ingredient_stock_quantity',sql`${t.quantity} BETWEEN 0 AND 1000000000`),check('ingredient_stock_low',sql`${t.low_threshold} BETWEEN 0 AND 1000000000`)]);
export const supplyOrders=sqliteTable('supply_order',{
 id:text().primaryKey(),store_id:integer().notNull().references(()=>stores.id),request_key:text().notNull(),signature:text().notNull(),creation_tag:text().notNull(),action_tag:text(),requested_by:text().notNull(),note:text().notNull().default(''),status:text().notNull().default('REQUESTED'),revision:integer().notNull().default(0),created_at:text().notNull().default(sql`CURRENT_TIMESTAMP`),updated_at:text().notNull().default(sql`CURRENT_TIMESTAMP`)
},t=>[uniqueIndex('supply_order_request').on(t.store_id,t.request_key),index('supply_order_store_status').on(t.store_id,t.status,t.created_at),check('supply_order_status',sql`${t.status} IN ('REQUESTED','APPROVED','SHIPPED','PARTIAL','RECEIVED','CANCELLED','REJECTED')`)]);
export const supplyLines=sqliteTable('supply_line',{
 id:text().primaryKey(),order_id:text().notNull().references(()=>supplyOrders.id),ingredient_id:integer().notNull().references(()=>ingredients.id),name:text().notNull(),unit:text().notNull(),pack_label:text().notNull(),pack_size:integer().notNull(),packs:integer().notNull(),ordered_units:integer().notNull(),received_units:integer().notNull().default(0)
},t=>[uniqueIndex('supply_order_ingredient').on(t.order_id,t.ingredient_id),check('supply_packs',sql`${t.packs} BETWEEN 1 AND 10000`),check('supply_units',sql`${t.ordered_units} BETWEEN 1 AND 1000000000`),check('supply_received',sql`${t.received_units}>=0 AND ${t.received_units}<=${t.ordered_units}`)]);
export const supplyReceipts=sqliteTable('supply_receipt',{
 id:text().primaryKey(),order_id:text().notNull().references(()=>supplyOrders.id),store_id:integer().notNull().references(()=>stores.id),request_key:text().notNull(),signature:text().notNull(),creation_tag:text().notNull(),actor:text().notNull(),note:text().notNull().default(''),created_at:text().notNull().default(sql`CURRENT_TIMESTAMP`)
},t=>[uniqueIndex('supply_receipt_request').on(t.store_id,t.request_key)]);
export const supplyReceiptLines=sqliteTable('supply_receipt_line',{
 receipt_id:text().notNull().references(()=>supplyReceipts.id),line_id:text().notNull().references(()=>supplyLines.id),quantity:integer().notNull()
},t=>[primaryKey({columns:[t.receipt_id,t.line_id]}),check('receipt_positive',sql`${t.quantity}>0`)]);
export const ingredientMovements=sqliteTable('ingredient_movement',{
 id:integer().primaryKey({autoIncrement:true}),store_id:integer().notNull().references(()=>stores.id),ingredient_id:integer().notNull().references(()=>ingredients.id),kind:text().notNull(),delta:integer().notNull(),before_quantity:integer().notNull(),after_quantity:integer().notNull(),reason:text().notNull(),actor:text().notNull(),receipt_id:text().references(()=>supplyReceipts.id),created_at:text().notNull().default(sql`CURRENT_TIMESTAMP`)
},t=>[uniqueIndex('ingredient_movement_receipt').on(t.receipt_id,t.ingredient_id),index('ingredient_movement_store').on(t.store_id,t.id),check('ingredient_movement_kind',sql`${t.kind} IN ('ADJUST','RECEIPT')`)]);
export const supplyEvents=sqliteTable('supply_event',{
 id:integer().primaryKey({autoIncrement:true}),order_id:text().notNull().references(()=>supplyOrders.id),status:text().notNull(),actor:text().notNull(),note:text().notNull().default(''),created_at:text().notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const orderNotifications=sqliteTable('order_notification',{
 id:integer().primaryKey({autoIncrement:true}),store_id:integer().notNull().references(()=>stores.id),order_id:text().notNull().references(()=>orders.id),created_at:integer().notNull().default(sql`(unixepoch()*1000)`)
},t=>[uniqueIndex('notification_one_order').on(t.order_id),index('notification_store_cursor').on(t.store_id,t.id)]);
export const pushSubscriptions=sqliteTable('push_subscription',{
 id:text().primaryKey(),uid:text().notNull().references(()=>staffAccounts.uid),store_id:integer().notNull().references(()=>stores.id),endpoint:text().notNull(),p256dh:text().notNull(),auth:text().notNull(),generation:text().notNull(),enabled:integer().notNull().default(1),expires:integer().notNull(),last_test:integer().notNull().default(0)
},t=>[index('push_store_user').on(t.store_id,t.uid,t.enabled)]);
export const notificationDeliveries=sqliteTable('notification_delivery',{
 event_id:integer().notNull().references(()=>orderNotifications.id),subscription_id:text().notNull().references(()=>pushSubscriptions.id),generation:text().notNull(),status:text().notNull().default('PENDING'),attempts:integer().notNull().default(0),next_attempt:integer().notNull().default(0),lease:text(),last_result:text()
},t=>[primaryKey({columns:[t.event_id,t.subscription_id]}),index('delivery_pending').on(t.status,t.next_attempt)]);
