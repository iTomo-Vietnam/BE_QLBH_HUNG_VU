import { FindOptionsRelations, FindOptionsSelect } from "typeorm";
import { BaseSelect } from "@/shared/base/BaseSelect";
import { VatTransaction } from "@/database/models/VatTransaction";

export const VatTransactionSelectList: FindOptionsSelect<VatTransaction> = {
  ...BaseSelect, occurredAt: true, type: true, amount: true, refType: true,
  refId: true, refCode: true, panrterSnapshot: true,
};
export const VatTransactionSelectFull: FindOptionsSelect<VatTransaction> = VatTransactionSelectList;
export const VatTransactionRelationsList: FindOptionsRelations<VatTransaction> = {};
export const VatTransactionRelations: FindOptionsRelations<VatTransaction> = {};

