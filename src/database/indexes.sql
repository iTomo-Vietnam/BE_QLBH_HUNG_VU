-- ============================================================================
-- DATABASE INDEXES FOR ERP THÉP ĐÔNG ANH V2
-- Tối ưu hiệu năng cho hệ thống ERP đa doanh nghiệp
-- ============================================================================

-- ============================================================================
-- 1. INDEX CHO CÁC BẢNG LEDGER (immutable transaction logs)
-- ============================================================================

-- InventoryTransaction: truy vấn tồn kho theo product+warehouse+thời gian
CREATE INDEX IF NOT EXISTS "IDX_inventory_transactions_product_warehouse_time"
  ON inventory_transactions ("productId", "warehouseId", "occurredAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_inventory_transactions_ref"
  ON inventory_transactions ("refType", "refId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_inventory_transactions_company"
  ON inventory_transactions ("storeId", "occurredAt" DESC)
  WHERE "deletedAt" IS NULL;

-- DebtTransaction: truy vấn công nợ đối tác
CREATE INDEX IF NOT EXISTS "IDX_debt_transactions_partner_side_time"
  ON debt_transactions ("partnerId", "side", "occurredAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_debt_transactions_ref"
  ON debt_transactions ("refType", "refId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_debt_transactions_company"
  ON debt_transactions ("storeId", "occurredAt" DESC)
  WHERE "deletedAt" IS NULL;

-- CommissionDebtTransaction: truy vấn công nợ hoa hồng
CREATE INDEX IF NOT EXISTS "IDX_commission_debt_transactions_contact_time"
  ON commission_debt_transactions ("partnerContactId", "occurredAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_commission_debt_transactions_ref"
  ON commission_debt_transactions ("refType", "refId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_commission_debt_transactions_company"
  ON commission_debt_transactions ("storeId", "occurredAt" DESC)
  WHERE "deletedAt" IS NULL;

-- FundTransaction: truy vấn số dư quỹ
CREATE INDEX IF NOT EXISTS "IDX_fund_transactions_fund_time"
  ON fund_transactions ("fundId", "occurredAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_fund_transactions_ref"
  ON fund_transactions ("refType", "refId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_fund_transactions_company"
  ON fund_transactions ("storeId", "occurredAt" DESC)
  WHERE "deletedAt" IS NULL;

-- VatDebtTransaction
CREATE INDEX IF NOT EXISTS "IDX_vat_debt_transactions_company_time"
  ON vat_debt_transactions ("storeId", "occurredAt" DESC)
  WHERE "deletedAt" IS NULL;

-- ============================================================================
-- 2. INDEX CHO CHỨNG TỪ KHO (StockDocument)
-- ============================================================================

CREATE INDEX IF NOT EXISTS "IDX_stock_documents_company_type_status"
  ON stock_documents ("storeId", "type", "status")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_stock_documents_code"
  ON stock_documents ("storeId", "code")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_stock_documents_effective_date"
  ON stock_documents ("storeId", "effectiveDate" DESC)
  WHERE "deletedAt" IS NULL;

-- StockDocumentLine
CREATE INDEX IF NOT EXISTS "IDX_stock_document_lines_document"
  ON stock_document_lines ("stockDocumentId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_stock_document_lines_product"
  ON stock_document_lines ("productId", "warehouseId")
  WHERE "deletedAt" IS NULL;

-- ============================================================================
-- 3. INDEX CHO MUA HÀNG (Purchase, PurchaseQuotation, PurchaseRequisition)
-- ============================================================================

CREATE INDEX IF NOT EXISTS "IDX_purchases_company_status"
  ON purchases ("storeId", "status", "orderedAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_purchases_partner"
  ON purchases ("storeId", "partnerId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_purchase_lines_purchase"
  ON purchase_lines ("purchaseId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_purchase_quotations_company_status"
  ON purchase_quotations ("storeId", "approveStatus")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_purchase_requisitions_company_status"
  ON purchase_requisitions ("storeId", "status")
  WHERE "deletedAt" IS NULL;

-- ============================================================================
-- 4. INDEX CHO BÁN HÀNG (Quotation, QuotationRequest, Order)
-- ============================================================================

CREATE INDEX IF NOT EXISTS "IDX_orders_company_status_time"
  ON orders ("storeId", "status", "orderedAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_orders_partner"
  ON orders ("storeId", "partnerId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_order_lines_order"
  ON order_lines ("orderId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_order_lines_product"
  ON order_lines ("itemVariantId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_quotations_company_status"
  ON quotations ("storeId", "approveStatus")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_quotations_partner"
  ON quotations ("storeId", "partnerId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_quotation_lines_quotation"
  ON quotation_lines ("quotationId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_quotation_requests_company_status"
  ON quotation_requests ("storeId", "status")
  WHERE "deletedAt" IS NULL;

-- ============================================================================
-- 5. INDEX CHO SẢN XUẤT (Production)
-- ============================================================================

CREATE INDEX IF NOT EXISTS "IDX_productions_company_order"
  ON productions ("storeId", "orderId", "status")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_productions_factory"
  ON productions ("storeId", "factoryId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_production_materials_production"
  ON production_materials ("productionId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_production_receivers_production"
  ON production_receivers ("productionId")
  WHERE "deletedAt" IS NULL;

-- ============================================================================
-- 6. INDEX CHO KẾ TOÁN (Invoice, PaymentRequest, IncomeExpense)
-- ============================================================================

CREATE INDEX IF NOT EXISTS "IDX_invoices_company_partner"
  ON invoices ("storeId", "partnerId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_invoices_company_direction"
  ON invoices ("storeId", "direction")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_invoice_allocations_invoice"
  ON invoice_allocations ("invoiceId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_income_expenses_company_time"
  ON income_expenses ("storeId", "occurredAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_income_expenses_fund"
  ON income_expenses ("storeId", "fundId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_payment_requests_company_status"
  ON payment_requests ("storeId", "status")
  WHERE "deletedAt" IS NULL;

-- ============================================================================
-- 7. INDEX CHO DANH MỤC
-- ============================================================================

-- Product
CREATE INDEX IF NOT EXISTS "IDX_products_company_type"
  ON products ("storeId", "type")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_products_code"
  ON products ("storeId", "code")
  WHERE "deletedAt" IS NULL;

-- Partner
CREATE INDEX IF NOT EXISTS "IDX_partners_company_type"
  ON partners ("storeId", "type")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_partner_contacts_partner"
  ON partner_contacts ("partnerId")
  WHERE "deletedAt" IS NULL;

-- Employee
CREATE INDEX IF NOT EXISTS "IDX_employees_company"
  ON employees ("storeId")
  WHERE "deletedAt" IS NULL;

-- Warehouse
CREATE INDEX IF NOT EXISTS "IDX_warehouses_company"
  ON warehouses ("storeId")
  WHERE "deletedAt" IS NULL;

-- Fund
CREATE INDEX IF NOT EXISTS "IDX_funds_company"
  ON funds ("storeId")
  WHERE "deletedAt" IS NULL;

-- ============================================================================
-- 8. INDEX CHO CHUYỂN KHO & KIỂM KHO
-- ============================================================================

CREATE INDEX IF NOT EXISTS "IDX_warehouse_transfers_warehouses"
  ON warehouse_transfers ("fromWarehouseId", "toWarehouseId", "status")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_inventory_adjustments_company"
  ON inventory_adjustments ("storeId", "status")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_inventory_conversions_company"
  ON inventory_conversions ("storeId", "status")
  WHERE "deletedAt" IS NULL;

-- ============================================================================
-- 9. INDEX CHO CỔNG BẢO VỆ (GateLog)
-- ============================================================================

CREATE INDEX IF NOT EXISTS "IDX_gate_logs_stock_document"
  ON gate_logs ("stockDocumentId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_gate_logs_vehicle"
  ON gate_logs ("vehiclePlate", "status")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_gate_logs_company_time"
  ON gate_logs ("storeId", "timeAt" DESC)
  WHERE "deletedAt" IS NULL;

-- ============================================================================
-- 10. INDEX CHO XÁC THỰC & PHÂN QUYỀN
-- ============================================================================

CREATE INDEX IF NOT EXISTS "IDX_store_users_user"
  ON store_users ("userId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_store_users_store_role"
  ON store_users ("storeId", "roleId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_login_approvals_user_device"
  ON login_approvals ("userId", "deviceId", "status")
  WHERE "deletedAt" IS NULL;

-- ============================================================================
-- 11. INDEX CHO OPERATION LOG
-- ============================================================================

-- Migration: thêm cột storeId (nếu chưa có)
-- ALTER TABLE operation_logs ADD COLUMN "storeId" uuid NULL;

CREATE INDEX IF NOT EXISTS "IDX_operation_logs_target"
  ON operation_logs ("targetEntity", "targetId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_operation_logs_actor_time"
  ON operation_logs ("actorId", "createdAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_operation_logs_action"
  ON operation_logs ("action", "createdAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_operation_logs_company"
  ON operation_logs ("storeId", "createdAt" DESC)
  WHERE "deletedAt" IS NULL;

-- ============================================================================
-- 12. INDEX CHO THÔNG BÁO (Notification)
-- ============================================================================

CREATE INDEX IF NOT EXISTS "IDX_user_notifications_user_read"
  ON user_notifications ("userId", "isRead")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_notifications_company"
  ON notifications ("storeId", "createdAt" DESC)
  WHERE "deletedAt" IS NULL;

-- ============================================================================
-- 13. INDEX CHO VẬN CHUYỂN (ShippingPlan)
-- ============================================================================

CREATE INDEX IF NOT EXISTS "IDX_shipping_plans_company"
  ON shipping_plans ("storeId", "status")
  WHERE "deletedAt" IS NULL;

-- ============================================================================
-- NOTE:
-- - Tất cả index dùng WHERE "deletedAt" IS NULL để tối ưu soft delete
-- - Composite index được thiết kế theo thứ tự truy vấn phổ biến nhất
-- - Các index trên bảng ledger đặc biệt quan trọng cho hiệu năng báo cáo
-- ============================================================================
