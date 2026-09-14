import {
  Attribute,
  AttributeType,
  ATTRIBUTE_NAMES,
  AttributeName,
  STORE_SCOPED_ATTRIBUTE_TYPES,
  isStoreScopedAttributeType,
} from "./Attribute";
import { DebtAdjustment } from "./DebtAdjustment";
import { DebtTransaction, DebtRefType } from "./DebtTransaction";
import { File, EntityType, FileCategory, FileStatus, FileType } from "./File";
import { Fund, FundSnapshot, FundType } from "./Fund";
import { FundAdjustment } from "./FundAdjustment";
import { FundTransaction, FundTransactionRefType } from "./FundTransaction";
import { FundTransfer } from "./FundTransfer";
import { Notification, ActionType, NotificationType } from "./Notification";
import { OtpToken, OtpPurpose } from "./OtpToken";
import { Partner, PartnerSnapshot, PartnerType } from "./Partner";
import { PartnerContact } from "./PartnerContact";
import { Product, ProductSnapshot, StockMetadata } from "./Product";
import { ProductExtraUnit } from "./ProductExtraUnit";
import { Role } from "./store/Role";
import { Store, StoreSnapshot } from "./Store";
import { StoreTransfer } from "./StoreTransfer";
import { StoreTransferLine } from "./StoreTransferLine";
import { User } from "./User";
import { VatAdjustment } from "./VatDebtAdjustment";
import { VatTransaction, VatRefType } from "./VatTransaction";
import {
  IncomeExpense,
  IncomeExpenseStatus,
  IncomeExpenseType,
} from "./store/IncomeExpense";
import { InventoryAdjustment } from "./store/InventoryAdjustment";
import { InventoryAdjustmentLine } from "./store/InventoryAdjustmentLine";
import {
  InventoryTransaction,
  InventoryRefType,
} from "./store/InventoryTransaction";
import {
  Order,
  OrderSnapshot,
  OrderStatus,
  OrderType,
  ReturnOrderTypes,
} from "./store/Order";
import { OrderLine } from "./store/OrderLine";
import { ProductPriceHistory } from "./store/ProductPriceHistory";
import { StoreProduct } from "./store/StoreProduct";
import { StoreProductLocation } from "./store/StoreProductLocation";
import { StoreUser } from "./store/StoreUser";
import { InternalExport } from "./store/InternalExport";
import { InternalExportLine } from "./store/InternalExportLine";
import { OperationLog } from "./OperationLog";
import { TransferNote, TransferNoteStatus } from "./TransferNote";
import {
  DailyReport,
  DailyReportStatus,
} from "./DailyReport";

/** Single source of truth for TypeORM entities in the store-scoped model. */
export const entities = [
  Attribute,
  DebtAdjustment,
  DebtTransaction,
  File,
  Fund,
  FundAdjustment,
  FundTransaction,
  FundTransfer,
  Notification,
  OtpToken,
  Partner,
  PartnerContact,
  Product,
  ProductExtraUnit,
  Role,
  Store,
  StoreTransfer,
  StoreTransferLine,
  User,
  VatAdjustment,
  VatTransaction,
  IncomeExpense,
  InventoryAdjustment,
  InventoryAdjustmentLine,
  InventoryTransaction,
  Order,
  OrderLine,
  ProductPriceHistory,
  StoreProduct,
  StoreProductLocation,
  StoreUser,
  InternalExport,
  InternalExportLine,
  OperationLog,
  TransferNote,
  DailyReport,
];

export {
  Attribute,
  AttributeType,
  ATTRIBUTE_NAMES,
  AttributeName,
  STORE_SCOPED_ATTRIBUTE_TYPES,
  isStoreScopedAttributeType,
  DebtAdjustment,
  DebtTransaction,
  DebtRefType,
  File,
  EntityType,
  FileCategory,
  FileStatus,
  FileType,
  Fund,
  FundSnapshot,
  FundType,
  FundAdjustment,
  FundTransaction,
  FundTransactionRefType,
  FundTransfer,
  Notification,
  ActionType,
  NotificationType,
  OtpToken,
  OtpPurpose,
  Partner,
  PartnerSnapshot,
  PartnerType,
  PartnerContact,
  Product,
  ProductSnapshot,
  StockMetadata,
  ProductExtraUnit,
  ProductPriceHistory,
  StoreProduct,
  StoreProductLocation,
  Role,
  Store,
  StoreSnapshot,
  StoreTransfer,
  StoreTransferLine,
  User,
  VatAdjustment,
  StoreUser,
  InternalExport,
  InternalExportLine,
  VatTransaction,
  VatRefType,
  IncomeExpense,
  IncomeExpenseStatus,
  IncomeExpenseType,
  InventoryAdjustment,
  InventoryAdjustmentLine,
  InventoryTransaction,
  InventoryRefType,
  Order,
  OrderSnapshot,
  OrderStatus,
  OrderType,
  OrderLine,
  ReturnOrderTypes,
  OperationLog,
  TransferNote,
  TransferNoteStatus,
  DailyReport,
  DailyReportStatus,
};
