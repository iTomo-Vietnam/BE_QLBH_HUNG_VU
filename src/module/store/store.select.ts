import { Store } from "@/database/models/Store";
import { BaseSelect } from "@/shared/base/BaseSelect";
import { FindOptionsRelations, FindOptionsSelect } from "typeorm";

export const StoreSelectBasic: FindOptionsSelect<Store> = {
  ...BaseSelect,
  name: true,
  code: true,
  phone: true,
  email: true,
  taxCode: true,
  address: true,
  isActive: true,
  workEndTime: true,
};

export const StoreSelectFull: FindOptionsSelect<Store> = {
  ...StoreSelectBasic,
};
export const StoreSelectList = StoreSelectBasic;

export const StoreRelations: FindOptionsRelations<Store> = {};
export const StoreRelationsList: FindOptionsRelations<Store> = {};
