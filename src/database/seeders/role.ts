import { DeepPartial } from "typeorm";
import { Role } from "../models/store/Role";
import {
  createPermissions,
  Module,
  Permission,
} from "@/shared/middleware/permission.middleware";

const permissionsFor = (values: Partial<Record<Module, Permission[]>>) => {
  const permissions = createPermissions("empty");
  Object.entries(values).forEach(([module, modulePermissions]) => {
    permissions[module as Module] = modulePermissions || [];
  });
  return permissions;
};

const readOnly = ["read"] as Permission[];
const editable = ["create", "read", "update"] as Permission[];
const salesPermissions = [
  "create",
  "read",
  "update",
  "complete",
] as Permission[];
const warehousePermissions = [
  "create",
  "read",
  "update",
  "complete",
] as Permission[];
const accountingPermissions = [
  "create",
  "read",
  "update",
  "delete",
] as Permission[];

/** Mẫu role được nhân bản cho từng cửa hàng khi seed hoặc tạo cửa hàng mới. */
export const roleSeeders: DeepPartial<Role>[] = [
  {
    name: "Quản trị chi nhánh",
    permissions: createPermissions(),
    importExcel: ["product", "customer", "supplier"],
    exportExcel: [],
    isDefault: true,
  },
  {
    name: "Nhân viên kho",
    permissions: permissionsFor({
      dashboard: readOnly,
      inventoryReport: readOnly,
      purchase: warehousePermissions,
      purchaseReturn: warehousePermissions,
      storeTransfer: warehousePermissions,
      inventoryAdjustment: editable,
      internalExport: editable,
      product: readOnly,
      supplier: readOnly,
      store: readOnly,
    }),
    importExcel: ["product"],
    exportExcel: [],
    isDefault: false,
  },
  {
    name: "Kế toán",
    permissions: permissionsFor({
      dashboard: readOnly,
      reports: readOnly,
      debtReport: readOnly,
      fundReport: readOnly,
      vatReport: readOnly,
      incomeExpense: [...accountingPermissions, "complete"],
      transferNote: accountingPermissions,
      dailyReport: ["create", "read", "update"],
      fund: editable,
      fundAdjustment: accountingPermissions,
      fundTransfer: accountingPermissions,
      debtAdjustment: accountingPermissions,
      vatAdjustment: accountingPermissions,
      sale: readOnly,
      saleReturn: readOnly,
      purchase: readOnly,
      purchaseReturn: readOnly,
      customer: readOnly,
      supplier: readOnly,
      product: readOnly,
      store: readOnly,
    }),
    importExcel: ["product", "customer", "supplier"],
    exportExcel: [],
    isDefault: false,
  },
  {
    name: "Nhân viên bán hàng",
    permissions: permissionsFor({
      dashboard: readOnly,
      sale: salesPermissions,
      saleReturn: salesPermissions,
      customer: ["create", "read", "update"],
      product: readOnly,
      fund: readOnly,
      store: readOnly,
    }),
    importExcel: [],
    exportExcel: [],
    isDefault: false,
  },
];
