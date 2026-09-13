import { FindOptionsRelations, FindOptionsSelect } from "typeorm";
import { BaseSelect } from "@/shared/base/BaseSelect";
import { Fund } from "@/database/models/Fund";

export const FundSelectList: FindOptionsSelect<Fund> = {
  ...BaseSelect, code: true, name: true, type: true, bank: true,
  accountNumber: true, accountHolderName: true, branch: true, storeId: true, isPersonal: true, isActive: true,
  isDefault: true,
  store: { id: true, code: true, name: true },
};
export const FundSelectFull: FindOptionsSelect<Fund> = {
  ...FundSelectList,
  store: { id: true, code: true, name: true },
  fundAdjustments: true,
} as any;
export const FundRelationsList: FindOptionsRelations<Fund> = { store: true };
export const FundRelations: FindOptionsRelations<Fund> = { store: true, fundAdjustments: true } as any;
