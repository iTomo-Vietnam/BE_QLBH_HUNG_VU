import { DebtTransaction } from "@/database/models/DebtTransaction";
import { BaseSelect } from "@/shared/base/BaseSelect";
import { FindOptionsRelations, FindOptionsSelect } from "typeorm";

export const DebtTransactionSelectList: FindOptionsSelect<DebtTransaction> = {
  ...BaseSelect,
  occurredAt: true,
  partnerId: true,
  side: true,
  type: true,
  amount: true,
  refType: true,
  refId: true,
  refCode: true,
};

export const DebtTransactionSelectFull: FindOptionsSelect<DebtTransaction> = {
  ...DebtTransactionSelectList,
};

export const DebtTransactionRelations: FindOptionsRelations<DebtTransaction> = {};
export const DebtTransactionRelationsList: FindOptionsRelations<DebtTransaction> = {};

