import { FindOptionsRelations, FindOptionsSelect } from "typeorm";
import { BaseSelect } from "@/shared/base/BaseSelect";
import { StoreTransfer } from "@/database/models/StoreTransfer";

export const StoreTransferSelectList: FindOptionsSelect<StoreTransfer> = {
  ...BaseSelect,
  occurredAt: true,
  status: true,
  exportedAt: true,
  exporterId: true,
  exporterSnapshot: true,
  importedAt: true,
  importerId: true,
  importerSnapshot: true,
  canceledAt: true,
  cancelerId: true,
  cancelerSnapshot: true,
  code: true,
  fromStoreId: true,
  fromStoreSnapshot: true,
  toStoreId: true,
  toStoreSnapshot: true,
  reason: true,
  lines: true,
  fromStore: { id: true, code: true, name: true },
  toStore: { id: true, code: true, name: true },
};
export const StoreTransferSelectFull: FindOptionsSelect<StoreTransfer> = {
  ...StoreTransferSelectList,
  fromStore: { id: true, code: true, name: true },
  toStore: { id: true, code: true, name: true },
  lines: {
    id: true,
    transferId: true,
    productId: true,
    productSnapshot: true,
    unitId: true,
    unitSnapshot: true,
    conversionRateAtTime: true,
    quantity: true,
    differenceCostPriceAmount: true,
    product: { id: true, code: true, name: true, baseUnitId: true },
    unit: { id: true, name: true, type: true },
  },
};
export const StoreTransferRelationsList: FindOptionsRelations<StoreTransfer> = {
  fromStore: true,
  toStore: true,
  lines: true,
};
export const StoreTransferRelations: FindOptionsRelations<StoreTransfer> = {
  ...StoreTransferRelationsList,
  lines: { product: true, unit: true },
};
