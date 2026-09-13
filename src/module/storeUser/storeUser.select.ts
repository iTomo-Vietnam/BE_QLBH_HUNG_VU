import { FindOptionsRelations, FindOptionsSelect } from "typeorm";
import { BaseSelect } from "@/shared/base/BaseSelect";
import { StoreUser } from "@/database/models/store/StoreUser";

export const StoreUserSelectList: FindOptionsSelect<StoreUser> = {
  ...BaseSelect, storeId: true, userId: true,
  store: { id: true, code: true, name: true },
  roleId: true,
  role: { id: true, storeId: true, name: true, permissions: true, importExcel: true, exportExcel: true },
  user: { id: true, code: true, name: true, username: true, isActive: true },
};
export const StoreUserSelectFull: FindOptionsSelect<StoreUser> = {
  ...StoreUserSelectList,
  store: { id: true, code: true, name: true },
  roleId: true,
  role: { id: true, storeId: true, name: true, permissions: true, importExcel: true, exportExcel: true },
  user: { id: true, code: true, name: true, username: true, isActive: true },
} as any;
export const StoreUserRelationsList: FindOptionsRelations<StoreUser> = { store: true, user: true, role: true };
export const StoreUserRelations: FindOptionsRelations<StoreUser> = StoreUserRelationsList;
