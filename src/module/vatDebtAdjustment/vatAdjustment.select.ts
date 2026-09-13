import { FindOptionsRelations, FindOptionsSelect } from "typeorm";
import { BaseSelect } from "@/shared/base/BaseSelect";
import { VatAdjustment } from "@/database/models/VatDebtAdjustment";

export const VatAdjustmentSelectList: FindOptionsSelect<VatAdjustment> = {
  ...BaseSelect, code: true, occurredAt: true, expectedAmount: true,
  countedAmount: true, deltaAmount: true, reason: true, isInitial: true,
};
export const VatAdjustmentSelectFull: FindOptionsSelect<VatAdjustment> = VatAdjustmentSelectList;
export const VatAdjustmentRelationsList: FindOptionsRelations<VatAdjustment> = {};
export const VatAdjustmentRelations: FindOptionsRelations<VatAdjustment> = {};

