import { z } from "zod";
import {
  BaseCreateSchema,
  BaseQuerySchema,
  BaseUpdateSchema,
} from "@/shared/base/BaseValidator";
import { EXCEL_MODULES } from "@/shared/types/excel";

const PermissionSchema = z.record(
  z.string(),
  z.array(
    z.enum(["create", "read", "update", "delete", "approve", "complete"]),
  ),
);

const ExcelPermissionModulesSchema = z.array(z.enum(EXCEL_MODULES)).default([]);

export const CreateRoleSchema = BaseCreateSchema.extend({
  storeId: z.uuid().optional(),
  name: z.string().trim().min(1).max(255),
  permissions: PermissionSchema.optional().default({}),
  importExcel: ExcelPermissionModulesSchema,
  exportExcel: ExcelPermissionModulesSchema,
});

export const UpdateRoleSchema = BaseUpdateSchema.extend({
  storeId: z.uuid().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  permissions: PermissionSchema.optional(),
  importExcel: ExcelPermissionModulesSchema.optional(),
  exportExcel: ExcelPermissionModulesSchema.optional(),
});

export const RoleQuerySchema = BaseQuerySchema;
