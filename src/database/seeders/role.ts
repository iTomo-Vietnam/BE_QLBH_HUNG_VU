import { DeepPartial } from "typeorm";
import { Role } from "../models/store/Role";
import { createPermissions, MODULES } from "@/shared/middleware/permission.middleware";
import { EXCEL_MODULES } from "@/shared/types/excel";

export const roleSeeders: DeepPartial<Role>[] = [
  {
    name: "Quản lý cửa hàng",
    permissions: createPermissions(),
    importExcel: [...EXCEL_MODULES],
    exportExcel: [...EXCEL_MODULES],
    isDefault: true,
  },
  {
    name: "Nhân viên cửa hàng",
    permissions: createPermissions("empty"),
    importExcel: [],
    exportExcel: [],
    isDefault: false,
  },
];

export { MODULES };
