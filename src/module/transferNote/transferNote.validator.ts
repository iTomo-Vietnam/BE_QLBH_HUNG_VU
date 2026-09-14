import { z } from "zod";
import {
  BaseCreateSchema,
  BaseParamsSchema,
  BaseQuerySchema,
  BaseUpdateSchema,
  DateTransform,
} from "@/shared/base/BaseValidator";
import { TransferNoteStatus } from "@/database/models/TransferNote";

const TransferNoteFields = {
  occurredAt: DateTransform.optional(),
  referenceCode: z.string().trim().min(1).max(100),
  fundId: z.uuid(),
  amount: z.number().positive(),
  status: z.enum(TransferNoteStatus).optional(),
  invalidReason: z.string().trim().nullish(),
};

export const CreateTransferNoteSchema = BaseCreateSchema.extend(TransferNoteFields);
export const UpdateTransferNoteSchema = BaseUpdateSchema.extend({
  occurredAt: DateTransform.optional(),
  referenceCode: z.string().trim().min(1).max(100).optional(),
  fundId: z.uuid().optional(),
  amount: z.number().positive().optional(),
  status: z.enum(TransferNoteStatus).optional(),
  invalidReason: z.string().trim().nullish(),
});
export const TransferNoteQuerySchema = BaseQuerySchema.extend({
  status: z.enum(TransferNoteStatus).optional(),
  fundId: z.uuid().optional(),
});
export const TransferNoteParamsSchema = BaseParamsSchema;
