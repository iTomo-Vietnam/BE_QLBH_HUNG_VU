import { z } from "zod";
import { Gender } from "@/shared/constants/enum";
import {
  AddressSchema,
  BaseCodeSchema,
  BaseCreateSchema,
  BaseParamsSchema,
  BaseQuerySchema,
  BaseUpdateSchema,
  DateTransform,
  zArrayable,
} from "@/shared/base/BaseValidator";

/**
 * StoreUser is managed together with User. The relation object sent by the
 * client is intentionally not accepted here; only the storeId is persisted.
 */
const UserStoreSchema = z.object({
  id: z.uuid().optional(),
  tempId: z.uuid().nullish(),
  storeId: z.uuid(),
  roleId: z.uuid().nullish(),
});

const UserStoreListSchema = z
  .array(UserStoreSchema)
  .refine(
    (items) => new Set(items.map((item) => item.storeId)).size === items.length,
    {
      message: "Mỗi cửa hàng chỉ được cấp quyền một lần",
      path: ["storeUsers"],
    },
  );

export const CreateUserSchema = BaseCreateSchema.extend({
  code: BaseCodeSchema.optional(),
  name: z.string().trim().min(1).max(255),

  username: z.string().trim().min(1).max(100),
  password: z.string().min(6).max(128),

  email: z.email().nullish(),
  phone: z.string().trim().max(30).nullish(),
  gender: z.enum(Gender).nullish(),
  dob: DateTransform.nullish(),
  address: AddressSchema.nullish(),

  isActive: z.boolean().optional().default(true),
  storeUsers: UserStoreListSchema.optional().default([]),
});

export const UpdateUserSchema = BaseUpdateSchema.extend({
  code: BaseCodeSchema.optional(),
  name: z.string().trim().min(1).max(255).optional(),

  username: z.string().trim().min(1).max(100).optional(),
  password: z.string().min(6).max(128).nullish(),

  email: z.email().nullish(),
  phone: z.string().trim().max(30).nullish(),
  gender: z.enum(Gender).nullish(),
  dob: DateTransform.nullish(),
  address: AddressSchema.nullish(),

  isActive: z.boolean().optional(),
  storeUsers: UserStoreListSchema.optional(),
});

export const UserQuerySchema = BaseQuerySchema.extend({
  roleIds: zArrayable(z.uuid()),
});

export const UserParamsSchema = BaseParamsSchema;

export type UserStoreDto = z.infer<typeof UserStoreSchema>;
export type CreateUserDto = z.infer<typeof CreateUserSchema>;
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
export type UserQueryDto = z.infer<typeof UserQuerySchema>;
export type UserParamsDto = z.infer<typeof UserParamsSchema>;
