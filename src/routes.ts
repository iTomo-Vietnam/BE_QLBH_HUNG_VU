import { Router } from "express";
import { IsNull } from "typeorm";
import { container } from "@/config/container";
import DatabaseConfig from "@/config/database";
import { getCode } from "@/shared/utils/code.utils";
import { companyResolver } from "@/shared/middleware/company.middleware";
import {
  authenticate,
  authorization,
} from "@/shared/middleware/auth.middleware";
import { asyncHandler } from "@/shared/utils/controller.utils";
import { AUTH_TYPES } from "@/module/auth/auth.types";
import { AuthRouter } from "@/module/auth/auth.route";
import { PRODUCT_TYPES } from "@/module/product/product.types";
import { ProductRouter } from "@/module/product/product.route";
import { PARTNER_TYPES } from "@/module/partner/partner.types";
import { PartnerRouter } from "@/module/partner/partner.route";
import { partnerContextMiddleware } from "@/module/partner/partner.middleware";
import { PARTNER_CONTACT_TYPES } from "@/module/partnerContact/partnerContact.types";
import { PartnerContactRouter } from "@/module/partnerContact/partnerContact.route";
import { ORDER_TYPES } from "@/module/order/order.types";
import { OrderRouter } from "@/module/order/order.route";
import { OrderController } from "@/module/order/order.controller";
import { OrderHistoryQuerySchema } from "@/module/order/order.validator";
import { orderContextMiddleware } from "@/module/order/order.middleware";
import { zodValidate } from "@/shared/middleware/validation.middleware";
import { ATTRIBUTE_TYPES } from "@/module/attribute/attribute.types";
import { AttributeRouter } from "@/module/attribute/attribute.route";
import { FILE_TYPES } from "@/module/file/file.types";
import { FileRouter } from "@/module/file/file.route";
import { STORE_TYPES } from "@/module/store/store.types";
import { StoreRouter } from "@/module/store/store.route";
import { INVENTORY_TYPES } from "@/module/inventory/inventory.types";
import { InventoryRouter } from "@/module/inventory/inventory.route";
import { INVENTORY_ADJUSTMENT_TYPES } from "@/module/inventoryAdjustment/inventoryAdjustment.types";
import { InventoryAdjustmentRouter } from "@/module/inventoryAdjustment/inventoryAdjustment.route";
import { STORE_TRANSFER_TYPES } from "@/module/storeTransfer/storeTransfer.types";
import { StoreTransferRouter } from "@/module/storeTransfer/storeTransfer.route";
import { INTERNAL_EXPORT_TYPES } from "@/module/internalExport/internalExport.types";
import { InternalExportRouter } from "@/module/internalExport/internalExport.route";
import { PRODUCT_PRICE_HISTORY_TYPES } from "@/module/productPriceHistory/productPriceHistory.types";
import { ProductPriceHistoryRouter } from "@/module/productPriceHistory/productPriceHistory.route";
import { INCOME_EXPENSE_TYPES } from "@/module/incomeExpense/incomeExpense.types";
import { IncomeExpenseRouter } from "@/module/incomeExpense/incomeExpense.route";
import { FUND_TYPES } from "@/module/fund/fund.types";
import { FundRouter } from "@/module/fund/fund.route";
import { FUND_ADJUSTMENT_TYPES } from "@/module/fundAdjustment/fundAdjustment.types";
import { FundAdjustmentRouter } from "@/module/fundAdjustment/fundAdjustment.route";
import { FUND_TRANSACTION_TYPES } from "@/module/fundTransaction/fundTransaction.types";
import { FundTransactionRouter } from "@/module/fundTransaction/fundTransaction.route";
import { FUND_TRANSFER_TYPES } from "@/module/fundTransfer/fundTransfer.types";
import { FundTransferRouter } from "@/module/fundTransfer/fundTransfer.route";
import { NOTIFICATION_TYPES } from "@/module/notification/notification.types";
import { NotificationRouter } from "@/module/notification/notification.route";
import { PRODUCT_EXTRA_UNIT_TYPES } from "@/module/productExtraUnit/productExtraUnit.types";
import { ProductExtraUnitRouter } from "@/module/productExtraUnit/productExtraUnit.route";
import { ROLE_TYPES } from "@/module/role/role.types";
import { RoleRouter } from "@/module/role/role.route";
import { STORE_PRODUCT_TYPES } from "@/module/storeProduct/storeProduct.types";
import { StoreProductRouter } from "@/module/storeProduct/storeProduct.route";
import { STORE_USER_TYPES } from "@/module/storeUser/storeUser.types";
import { StoreUserRouter } from "@/module/storeUser/storeUser.route";
import { USER_TYPES } from "@/module/user/user.types";
import { UserRouter } from "@/module/user/user.route";
import { DEBT_ADJUSTMENT_TYPES } from "@/module/debtAdjustment/debtAdjustment.types";
import { DebtAdjustmentRouter } from "@/module/debtAdjustment/debtAdjustment.route";
import { DEBT_TYPES } from "@/module/debt/debt.types";
import { DebtRouter } from "@/module/debt/debt.route";
import { DEBT_TRANSACTION_TYPES } from "@/module/debtTransaction/debtTransaction.types";
import { DebtTransactionRouter } from "@/module/debtTransaction/debtTransaction.route";
import { VAT_ADJUSTMENT_TYPES } from "@/module/vatDebtAdjustment/vatAdjustment.types";
import { VatAdjustmentRouter } from "@/module/vatDebtAdjustment/vatAdjustment.route";
import { VAT_TRANSACTION_TYPES } from "@/module/vatTransaction/vatTransaction.types";
import { VatTransactionRouter } from "@/module/vatTransaction/vatTransaction.route";
import { Product } from "@/database/models/Product";
import { InventoryTransaction } from "@/database/models/store/InventoryTransaction";
import { EXCEL_TYPES } from "@/module/excel/excel.types";
import { ExcelRouter } from "@/module/excel/excel.route";
import { DASHBOARD_TYPES } from "@/module/dashboard/dashboard.types";
import { DashboardRouter } from "@/module/dashboard/dashboard.route";
import { LOG_TYPES, LogRouter } from "./module/log";
import { ANALYSIS_TYPES, AnalysisRouter } from "@/module/analysis";
import { TRANSFER_NOTE_TYPES } from "@/module/transferNote/transferNote.types";
import { TransferNoteRouter } from "@/module/transferNote/transferNote.route";
import { DAILY_REPORT_TYPES } from "@/module/dailyReport/dailyReport.types";
import { DailyReportRouter } from "@/module/dailyReport/dailyReport.route";

const router = Router();
router.use(companyResolver);
router.get("/code", getCode);
router.use(
  "/auth",
  container.get<AuthRouter>(AUTH_TYPES.AuthRouter).getRouter(),
);
router.use(authenticate, authorization);
router.use("/log", container.get<LogRouter>(LOG_TYPES.LogRouter).getRouter());
router.use(
  "/excel",
  container.get<ExcelRouter>(EXCEL_TYPES.ExcelRouter).getRouter(),
);
router.use(
  "/dashboard",
  container.get<DashboardRouter>(DASHBOARD_TYPES.Router).getRouter(),
);
router.use(
  "/analysis",
  container.get<AnalysisRouter>(ANALYSIS_TYPES.Router).getRouter(),
);

router.use(
  "/attribute",
  container.get<AttributeRouter>(ATTRIBUTE_TYPES.AttributeRouter).getRouter(),
);
router.use(
  "/file",
  container.get<FileRouter>(FILE_TYPES.FileRouter).getRouter(),
);
router.use(
  "/store",
  container.get<StoreRouter>(STORE_TYPES.StoreRouter).getRouter(),
);
router.use(
  "/product",
  container.get<ProductRouter>(PRODUCT_TYPES.ProductRouter).getRouter(),
);

router.get(
  "/order/history",
  zodValidate(OrderHistoryQuerySchema, "query"),
  container
    .get<OrderController>(ORDER_TYPES.OrderController)
    .getAllTypesHistory,
);

const partnerRouter = container
  .get<PartnerRouter>(PARTNER_TYPES.PartnerRouter)
  .getRouter();
router.use("/customer", partnerContextMiddleware("customer"), partnerRouter);
router.use("/supplier", partnerContextMiddleware("supplier"), partnerRouter);
router.use("/shipper", partnerContextMiddleware("shipper"), partnerRouter);
router.use(
  "/partner-contact",
  container
    .get<PartnerContactRouter>(PARTNER_CONTACT_TYPES.PartnerContactRouter)
    .getRouter(),
);

router.use(
  "/sale",
  orderContextMiddleware("sale"),
  container.get<OrderRouter>(ORDER_TYPES.OrderRouter).getRouter(),
);
router.use(
  "/sale-return",
  orderContextMiddleware("saleReturn"),
  container.get<OrderRouter>(ORDER_TYPES.OrderRouter).getRouter(),
);
router.use(
  "/purchase",
  orderContextMiddleware("purchase"),
  container.get<OrderRouter>(ORDER_TYPES.OrderRouter).getRouter(),
);
router.use(
  "/purchase-return",
  orderContextMiddleware("purchaseReturn"),
  container.get<OrderRouter>(ORDER_TYPES.OrderRouter).getRouter(),
);

router.use(
  "/income-expense",
  container.get<IncomeExpenseRouter>(INCOME_EXPENSE_TYPES.Router).getRouter(),
);
router.use(
  "/transfer-note",
  container.get<TransferNoteRouter>(TRANSFER_NOTE_TYPES.Router).getRouter(),
);
router.use(
  "/daily-report",
  container.get<DailyReportRouter>(DAILY_REPORT_TYPES.Router).getRouter(),
);
router.use("/fund", container.get<FundRouter>(FUND_TYPES.Router).getRouter());
router.use(
  "/fund-adjustment",
  container.get<FundAdjustmentRouter>(FUND_ADJUSTMENT_TYPES.Router).getRouter(),
);
router.use(
  "/fund-transaction",
  container
    .get<FundTransactionRouter>(FUND_TRANSACTION_TYPES.Router)
    .getRouter(),
);
router.use(
  "/fund-transfer",
  container.get<FundTransferRouter>(FUND_TRANSFER_TYPES.Router).getRouter(),
);
router.use(
  "/inventory-adjustment",
  container
    .get<InventoryAdjustmentRouter>(INVENTORY_ADJUSTMENT_TYPES.Router)
    .getRouter(),
);
router.use(
  "/store-transfer",
  container.get<StoreTransferRouter>(STORE_TRANSFER_TYPES.Router).getRouter(),
);
router.use(
  "/internal-export",
  container.get<InternalExportRouter>(INTERNAL_EXPORT_TYPES.Router).getRouter(),
);
router.use(
  "/product-price-history",
  container
    .get<ProductPriceHistoryRouter>(PRODUCT_PRICE_HISTORY_TYPES.Router)
    .getRouter(),
);
router.use(
  "/notification",
  container
    .get<NotificationRouter>(NOTIFICATION_TYPES.NotificationRouter)
    .getRouter(),
);
router.use(
  "/product-extra-unit",
  container
    .get<ProductExtraUnitRouter>(PRODUCT_EXTRA_UNIT_TYPES.Router)
    .getRouter(),
);
router.use("/role", container.get<RoleRouter>(ROLE_TYPES.Router).getRouter());
router.use(
  "/store-product",
  container.get<StoreProductRouter>(STORE_PRODUCT_TYPES.Router).getRouter(),
);
router.use(
  "/store-user",
  container.get<StoreUserRouter>(STORE_USER_TYPES.Router).getRouter(),
);
router.use("/user", container.get<UserRouter>(USER_TYPES.Router).getRouter());
router.use(
  "/debt-adjustment",
  container.get<DebtAdjustmentRouter>(DEBT_ADJUSTMENT_TYPES.Router).getRouter(),
);
const debtRouter = container.get<DebtRouter>(DEBT_TYPES.DebtRouter).getRouter();
router.use("/debt", debtRouter);
router.use("/partner-debt", debtRouter);
router.use(
  "/debt-transaction",
  container
    .get<DebtTransactionRouter>(DEBT_TRANSACTION_TYPES.Router)
    .getRouter(),
);
router.use(
  "/vat-adjustment",
  container.get<VatAdjustmentRouter>(VAT_ADJUSTMENT_TYPES.Router).getRouter(),
);
router.use(
  "/vat-transaction",
  container.get<VatTransactionRouter>(VAT_TRANSACTION_TYPES.Router).getRouter(),
);

router.use(
  "/inventory",
  container.get<InventoryRouter>(INVENTORY_TYPES.InventoryRouter).getRouter(),
);
router.get(
  "/inventory-report/products",
  asyncHandler(async (_req, res) => {
    const data = await DatabaseConfig.getRepository(Product).find({
      where: { deletedAt: IsNull() } as any,
    });
    res.json({ success: true, statusCode: 200, message: "OK", data });
  }),
);
router.get(
  "/inventory-transaction-report",
  asyncHandler(async (req, res) => {
    const where: any = { deletedAt: IsNull() };
    if (req.query.productId) where.productId = req.query.productId;
    if (req.query.storeId) where.storeId = req.query.storeId;
    const data = await DatabaseConfig.getRepository(InventoryTransaction).find({
      where,
      order: { occurredAt: "ASC", createdAt: "ASC", id: "ASC" } as any,
    });
    res.json({ success: true, statusCode: 200, message: "OK", data });
  }),
);

export default router;
