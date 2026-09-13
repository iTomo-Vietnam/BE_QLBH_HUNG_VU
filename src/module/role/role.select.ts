import { FindOptionsRelations, FindOptionsSelect } from "typeorm";
import { BaseSelect } from "@/shared/base/BaseSelect";
import { Role } from "@/database/models/store/Role";

export const RoleSelectList: FindOptionsSelect<Role> = {
  ...BaseSelect,
  storeId: true,
  name: true,
  permissions: true,
  importExcel: true,
  exportExcel: true,
};
export const RoleSelectFull: FindOptionsSelect<Role> = {
  ...RoleSelectList,
  store: { id: true, code: true, name: true },
  storeUsers: { id: true, userId: true, storeId: true },
} as any;
export const RoleRelationsList: FindOptionsRelations<Role> = {};
export const RoleRelations: FindOptionsRelations<Role> = {
  store: true,
  storeUsers: true,
};
