import { Container } from "inversify";
import DatabaseConfig from "./database";
import { TYPES } from "@/shared/types/container.types";
import { attributeModule } from "@/module/attribute";
import { authModule } from "@/module/auth";
import { debtAdjustmentModule } from "@/module/debtAdjustment";
import { debtModule } from "@/module/debt";
import { debtTransactionModule } from "@/module/debtTransaction";
import { fileModule } from "@/module/file";
import { fundModule } from "@/module/fund";
import { fundAdjustmentModule } from "@/module/fundAdjustment";
import { fundTransactionModule } from "@/module/fundTransaction";
import { fundTransferModule } from "@/module/fundTransfer";
import { incomeExpenseModule } from "@/module/incomeExpense";
import { inventoryModule } from "@/module/inventory";
import { inventoryAdjustmentModule } from "@/module/inventoryAdjustment";
import { notificationModule } from "@/module/notification";
import { orderModule } from "@/module/order";
import { otpTokenModule } from "@/module/otpToken";
import { partnerModule } from "@/module/partner";
import { partnerContactModule } from "@/module/partnerContact";
import { productModule } from "@/module/product";
import { productExtraUnitModule } from "@/module/productExtraUnit";
import { productPriceHistoryModule } from "@/module/productPriceHistory";
import { roleModule } from "@/module/role";
import { storeModule } from "@/module/store";
import { storeProductModule } from "@/module/storeProduct";
import { storeTransferModule } from "@/module/storeTransfer";
import { internalExportModule } from "@/module/internalExport";
import { storeUserModule } from "@/module/storeUser";
import { userModule } from "@/module/user";
import { vatAdjustmentModule } from "@/module/vatDebtAdjustment";
import { vatTransactionModule } from "@/module/vatTransaction";
import { excelModule } from "@/module/excel";
import { dashboardModule } from "@/module/dashboard";
import { logModule } from "@/module/log";
import { analysisModule } from "@/module/analysis";
import { transferNoteModule } from "@/module/transferNote";
import { dailyReportModule } from "@/module/dailyReport";

// ================== Container Setup ====================
export const container = new Container();

container.bind(TYPES.DataSource).toConstantValue(DatabaseConfig);

container.load(
  authModule,
  attributeModule,
  fileModule,
  notificationModule,
  otpTokenModule,
  userModule,
  roleModule,
  storeModule,
  partnerModule,
  partnerContactModule,
  productModule,
  productExtraUnitModule,
  orderModule,
  inventoryModule,
  inventoryAdjustmentModule,
  storeTransferModule,
  internalExportModule,
  productPriceHistoryModule,
  fundModule,
  fundAdjustmentModule,
  fundTransactionModule,
  fundTransferModule,
  incomeExpenseModule,
  debtTransactionModule,
  debtModule,
  debtAdjustmentModule,
  vatAdjustmentModule,
  vatTransactionModule,
  storeProductModule,
  storeUserModule,
  excelModule,
  dashboardModule,
  logModule,
  analysisModule,
  transferNoteModule,
  dailyReportModule,
);
