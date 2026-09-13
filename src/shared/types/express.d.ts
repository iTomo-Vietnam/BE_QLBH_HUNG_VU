import type { Module, PermissionStructure } from "../middleware/permission.middleware";
import type { JwtPayload, UserContext, StoreContext, StorePermissionContext } from "./interfaces";
import { PartnerContext } from "./sub-context";

declare module "express-serve-static-core" {
  interface User extends JwtPayload {}

  interface Request {
    user?: JwtPayload;
    userContext?: UserContext | null;
    storeContext?: StoreContext | null;
    permissions?: PermissionStructure;
    availableStoreIds?: string[];
    storePermissions?: Record<string, StorePermissionContext>;
    permissionModule?: Module;
    partnerContext?: PartnerContext;
    importExcel?: Module[];
    exportExcel?: Module[];
    storeCode?: string;
    cookies: {
      access_token?: string;
      refresh_token?: string;
      [key: string]: any;
    };
  }
}

export {};
