import { z } from "zod";
import {
  BaseCreateSchema,
  BaseNullableUuidSchema,
  BaseQuerySchema,
  BaseUpdateSchema,
} from "@/shared/base/BaseValidator";
import { FundType } from "@/database/models/Fund";

const FundTypeSchema = z.enum(FundType);

export const CreateFundSchema = BaseCreateSchema.extend({
  code: z.string().trim().max(25).optional(),
  name: z.string().trim().min(1).max(255),
  type: FundTypeSchema,
  bank: z.string().trim().max(255).nullish(),
  accountNumber: z.string().trim().max(100).nullish(),
  accountHolderName: z.string().trim().max(100).nullish(),
  branch: z.string().trim().max(50).nullish(),
  storeId: BaseNullableUuidSchema,
  isPersonal: z.boolean().optional(),
  isActive: z.boolean().optional(),
  initialBalance: z.number().nonnegative().optional(),
});

export const UpdateFundSchema = BaseUpdateSchema.extend({
  code: z.string().trim().max(25).optional(),
  name: z.string().trim().min(1).max(255).optional(),
  type: FundTypeSchema.optional(),
  bank: z.string().trim().max(255).nullish(),
  accountNumber: z.string().trim().max(100).nullish(),
  accountHolderName: z.string().trim().max(100).nullish(),
  branch: z.string().trim().max(50).nullish(),
  storeId: BaseNullableUuidSchema,
  isPersonal: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const FundQuerySchema = BaseQuerySchema;
