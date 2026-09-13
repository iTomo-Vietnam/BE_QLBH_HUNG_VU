import { AuthUtils } from "../utils/auth.utils";
import { Request, Response, NextFunction } from "express";
import { ForbiddenError, UnauthorizedError } from "../types/errors";
import { JwtPayload } from "../types/interfaces";

/** Permission keys are deliberately limited to the current model/module set. */
export const MODULES = [
  "report", // Báo cáo
  "analysis", // Phân tích
  "reports", // Báo cáo chi tiết
  "debtReport", // Báo cáo công nợ
  "inventoryReport", // Báo cáo tồn kho
  "fundReport", // Báo cáo số dư quỹ
  "vatReport", // Báo cáo thuế GTGT

  // Bán hàng
  "sale", // Bán hàng
  "saleReturn", // Đổi trả hàng

  // Nhập xuất tồn kho
  "purchase", // Nhập hàng
  "purchaseReturn", // Đổi trả hàng mua
  "storeTransfer", // Chuyển kho
  "inventoryAdjustment", // Điều chỉnh tồn kho
  "internalExport", // Xuất nội bộ

  // Tài chính & kế toán
  "incomeExpense", // Thu chi
  "fund", // Quỹ
  "fundAdjustment", // Điều chỉnh số dư quỹ
  "fundTransfer", // Chuyển quỹ
  "debtAdjustment", // Điều chỉnh công nợ
  "vatAdjustment", // Điều chỉnh thuế GTGT

  // Đối tác
  "customer", // Khách hàng
  "supplier", // Nhà cung cấp
  "shipper", // Đơn vị vận chuyển

  // Thiết lập
  "product", // Sản phẩm
  "store", // Kho hàng

  "user", // Người dùng
  "role", // Vai trò hệ thống
  "attribute", // Danh mục
  "log", // Nhật ký thao tác
] as const;

export type Module = (typeof MODULES)[number];
export const PERMISSIONS = [
  "create",
  "read",
  "update",
  "delete",
  "approve",
  "complete",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type PermissionStructure = { [key in Module]?: Permission[] };

export const ReadOnlyModules: Module[] = [
  "report",
  "analysis",
  "reports",
  "debtReport",
  "inventoryReport",
  "fundReport",
  "vatReport",
  "log",
];
export const ApprovalModules: Module[] = [];
export const CompleteModules: Module[] = [
  "sale",
  "saleReturn",
  "purchase",
  "purchaseReturn",
  "storeTransfer",
];
export const readPermissionFallbackMap: Partial<Record<Module, Module[]>> = {
  product: [
    "sale",
    "saleReturn",
    "purchase",
    "purchaseReturn",
    "inventoryAdjustment",
    "storeTransfer",
    "internalExport",
  ],
  customer: ["sale"],
  fund: ["fundTransfer", "fundAdjustment"],
};

const checkPermissionFallback = (
  permissions: PermissionStructure,
  module: Module,
): boolean =>
  (readPermissionFallbackMap[module] || []).some(
    (fallback) =>
      permissions[fallback]?.includes("read") ||
      permissions[fallback]?.includes("create"),
  );

export const checkPermission = (
  req: Request,
  module: Module,
  permission: Permission,
): boolean => {
  const storeId = req.storeContext?.storeId;
  const permissions = storeId
    ? req.storePermissions?.[storeId]?.permissions || {}
    : ((req as any).permissions || {}) as PermissionStructure;
  const hasPermission = (value: PermissionStructure) =>
    Boolean(
      value[module]?.includes(permission) ||
        (permission === "read" && checkPermissionFallback(value, module)),
    );

  if (hasPermission(permissions)) return true;
  if (!storeId && req.storePermissions) {
    return Object.values(req.storePermissions).some((scope) =>
      hasPermission(scope.permissions),
    );
  }
  return false;
};

export const getAvailableStoreIds = (
  req: Request,
  module: Module,
  permission: Permission = "read",
): string[] => {
  if (AuthUtils.isAdmin((req as any).user)) return [];
  return Object.values(req.storePermissions || {})
    .filter((scope) =>
      Boolean(
        scope.permissions[module]?.includes(permission) ||
          (permission === "read" && checkPermissionFallback(scope.permissions, module)),
      ),
    )
    .map((scope) => scope.storeId);
};

export const permissionMiddleware =
  (module: Module | ((req: Request) => Module), permission: Permission) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const jwtUser = (req as any).user as JwtPayload | undefined;
      if (!jwtUser?.userId)
        throw new UnauthorizedError("Yêu cầu đăng nhập");
      const isAdmin = AuthUtils.isAdmin(jwtUser);
      const resolved = typeof module === "function" ? module(req) : module;
      const allowed = isAdmin
        ? true
        : permission === "read"
          ? getAvailableStoreIds(req, resolved, permission).length > 0
          : checkPermission(req, resolved, permission);
      if (!allowed)
        throw new ForbiddenError("Bạn không có quyền thực hiện thao tác này");
      req.permissionModule = resolved;
      if (permission === "read" && !isAdmin) {
        req.availableStoreIds = getAvailableStoreIds(req, resolved, permission);
      }
      next();
    } catch (error) {
      next(error);
    }
  };

export function createPermissions(
  mode: "empty" | "full" = "full",
): PermissionStructure {
  const permissions: PermissionStructure = {};
  for (const module of MODULES) {
    if (mode === "empty") {
      permissions[module] = [];
      continue;
    }
    permissions[module] = ReadOnlyModules.includes(module)
      ? ["read"]
      : ["create", "read", "update", "delete"];
    if (ApprovalModules.includes(module)) permissions[module]!.push("approve");
    if (CompleteModules.includes(module)) permissions[module]!.push("complete");
  }
  return permissions;
}
