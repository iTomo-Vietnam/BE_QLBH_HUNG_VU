import { FindOptionsRelations, FindOptionsSelect } from "typeorm";
import { BaseSelect } from "@/shared/base/BaseSelect";
import { DebtAdjustment } from "@/database/models/DebtAdjustment";

export const DebtAdjustmentSelectList: FindOptionsSelect<DebtAdjustment> = {
  ...BaseSelect,
  code: true,
  occurredAt: true,
  side: true,
  partnerId: true,
  partnerSnapshot: true,
  expectedAmount: true,
  countedAmount: true,
  deltaAmount: true,
  reason: true,
  isInitial: true,
};
export const DebtAdjustmentSelectFull: FindOptionsSelect<DebtAdjustment> = {
  ...DebtAdjustmentSelectList,
  partner: { id: true, type: true, name: true, code: true, phone: true },
} as any;
export const DebtAdjustmentRelationsList: FindOptionsRelations<DebtAdjustment> = {};
export const DebtAdjustmentRelations: FindOptionsRelations<DebtAdjustment> = { partner: true };

