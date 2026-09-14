import { FindOptionsRelations, FindOptionsSelect } from "typeorm";
import { BaseSelect } from "@/shared/base/BaseSelect";
import { TransferNote } from "@/database/models/TransferNote";

export const TransferNoteSelectList: FindOptionsSelect<TransferNote> = {
  ...BaseSelect,
  storeId: true,
  occurredAt: true,
  referenceCode: true,
  fundId: true,
  fundSnapshot: true,
  amount: true,
  status: true,
  invalidReason: true,
  fund: { id: true, code: true, name: true, type: true, storeId: true, isPersonal: true },
};

export const TransferNoteSelectFull: FindOptionsSelect<TransferNote> = {
  ...TransferNoteSelectList,
  fund: { id: true, code: true, name: true, type: true, storeId: true, isPersonal: true },
} as any;

export const TransferNoteRelationsList: FindOptionsRelations<TransferNote> = {
  fund: true,
};
export const TransferNoteRelations: FindOptionsRelations<TransferNote> = {
  fund: true,
};
