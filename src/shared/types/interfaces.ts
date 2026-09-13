import { Request, Response } from "express";
import {
  DeepPartial,
  EntityManager,
  FindManyOptions,
  FindOptionsWhere,
} from "typeorm";
import { IError } from "./errors";
import { UserSnapshot } from "../base/BaseEntity";
import { AttributeType } from "@/database/models/Attribute";
import { Module, PermissionStructure } from "../middleware/permission.middleware";

// Type alias for EntityManager to abstract TypeORM dependency
export type IEntityManager = EntityManager;

export type ICreateDto<T> = DeepPartial<T>;

export interface IRepository<T> {
  // Basic CRUD with soft delete awareness
  findById(
    id: string,
    manager?: EntityManager,
    includeDeleted?: boolean,
  ): Promise<T | null>;
  findAll(manager?: EntityManager, includeDeleted?: boolean): Promise<T[]>;
  create(entity: DeepPartial<T>, manager?: EntityManager): Promise<T>;
  update(
    id: string,
    entity: Partial<T>,
    manager?: EntityManager,
  ): Promise<T | null>;
  findOne(
    options: FindOptionsWhere<T>,
    manager?: EntityManager,
    includeDeleted?: boolean,
  ): Promise<T | null>;
  exists(
    options: FindOptionsWhere<T>,
    manager?: EntityManager,
    includeDeleted?: boolean,
  ): Promise<boolean>;

  // Delete operations
  delete(id: string, manager?: EntityManager): Promise<boolean>; // Hard delete
  softDelete(id: string, manager?: EntityManager): Promise<boolean>; // Soft delete
  restore(id: string, manager?: EntityManager): Promise<boolean>; // Restore soft deleted

  // Soft delete specific methods
  findDeleted(manager?: EntityManager): Promise<T[]>;
  findByIdWithDeleted(id: string, manager?: EntityManager): Promise<T | null>;
  isDeleted(id: string, manager?: EntityManager): Promise<boolean>;

  // Batch operations
  createMany(entities: DeepPartial<T>[], manager?: EntityManager): Promise<T[]>;
  updateMany(
    ids: string[],
    entity: Partial<T>,
    manager?: EntityManager,
  ): Promise<T[]>;
  deleteMany(ids: string[], manager?: EntityManager): Promise<number>;
  softDeleteMany(ids: string[], manager?: EntityManager): Promise<number>;
  restoreMany(ids: string[], manager?: EntityManager): Promise<number>;

  findWithPagination(
    options: FindManyOptions<T>,
    manager?: EntityManager,
    includeDeleted?: boolean,
  ): Promise<{ data: T[]; total: number }>;

  // Utility methods
  count(
    where?: FindOptionsWhere<T>,
    manager?: EntityManager,
    includeDeleted?: boolean,
  ): Promise<number>;
  withTransaction<R>(
    operation: (manager: EntityManager) => Promise<R>,
  ): Promise<R>;
}

export interface IService<T> {
  findById(id: string): Promise<ApiResponse<T> | null>;
  findAll(): Promise<ApiResponse<T[]>>;
  create(entity: DeepPartial<T>): Promise<ApiResponse<T>>;
  update(id: string, entity: Partial<T>): Promise<ApiResponse<T> | null>;
  delete(id: string): Promise<ApiResponse<Boolean>>;
}

export type CompareOperator = ">=" | ">" | "<=" | "<" | "=";
export const rangeSuffixes = ["Gte", "Gt", "Eq", "Lte", "Lt"];
export type RangeSuffix = (typeof rangeSuffixes)[number];
export const OPERATOR_MAP: Record<RangeSuffix, CompareOperator> = {
  Gte: ">=",
  Gt: ">",
  Lte: "<=",
  Lt: "<",
  Eq: "=",
};

export interface IController {
  // Controllers will have different methods based on their specific needs
}

export interface UserContext {
  userId: string;
  userSnapshot: UserSnapshot;
  isAdmin: boolean;
  isSystem?: boolean;
  employeeId?: string;
}

export interface StorePermissionContext {
  storeId: string;
  roleId?: string | null;
  roleName?: string | null;
  permissions: PermissionStructure;
  importExcel: Module[];
  exportExcel: Module[];
}

export interface StoreContext {
  storeId: string;
  companyName: string;
  companyCode: string;
  /** Store context is the canonical scope; storeId is a compatibility alias. */
  companyType?: string;
}

export type ActionKey =
  | "update"
  | "delete"
  | "assign"
  | "unassign"
  | "confirm"
  | "cancelConfirm"
  | "cancel"
  | "approve"
  | "reject"
  | "submit"
  | "complete"
  | "archive"
  | "restore"
  | "updateMode"
  | "start"
  | "arrive"
  | "accept"
  | "sendMessage"
  | "pay"
  | "export"
  | "import"
  | "remind"
  | "createPurchase"
  | "createShippingPlan"
  | "createStockDocument"
  | "createInvoice"
  | "createPayment"
  | "createQuotation"
  | "createOrder"
  | "customerApprove"
  | "customerReject"
  | "confirmExport"
  | "confirmImport";

export type ActionValue = {
  can: boolean;
  reason?: string;
};
export type ActionMap = Partial<Record<ActionKey, ActionValue>>;

/** Context được extract từ request, dùng trong service thay vì raw Request */
export interface RequestContext {
  query?: any;
  permissions?: PermissionStructure;
  availableStoreIds?: string[];
  storePermissions?: Record<string, StorePermissionContext>;
  permissionModule?: string;
  userContext?: UserContext;
  storeContext?: StoreContext;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface JwtPayload {
  userId: string;
  username: string;
  iat?: number;
  exp?: number;
}

export interface RequestWithUser extends Request {
  user?: JwtPayload;
  cookies: {
    access_token?: string;
    refresh_token?: string;
    [key: string]: any;
  };
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
}

export interface Pagination {
  totalRecords: number;
  currentPage: number;
  size: number;
  totalPages: number;
}

export interface SendResponseParams {
  res: Response;
  data?: any;
  message?: string;
  statusCode?: number;
}

export interface SendErrorParams {
  res: Response;
  message?: string;
  statusCode?: number;
  errors?: IError[];
}

export interface ApiResponse<T = any> {
  statusCode: number;
  success: boolean;
  message: string;
  data: T;
  pagination?: Pagination;
  errors?: any;
  code?: string;
  summary?: any; // Optional error code for more specific error handling
}

export interface IFindOptions<T> extends FindManyOptions<T> {
  page?: number;
  size?: number;
  keyword?: string; // Keyword for text search
  searchFields?: (keyof T)[]; // Fields to search in
  timeField?: keyof T; // Field to apply the date range filter on
  summaryFields?: (keyof T)[]; // Fields to summarize
  type?: string; // Example field for filtering by type
  status?: string; // Example field for filtering by status
  startAt?: Date; // Example field for filtering by date range
  endAt?: Date; // Example field for filtering by date range
  sortBy?: string; // Field to sort by
  sortOrder?: "ASC" | "DESC"; // Sort type
  isFinished?: boolean; // Example field for filtering by completion status
  filterOptions?: (keyof T)[]; // Additional filter options
  projectId?: string; // Example field for filtering by project ID
  employeeId?: string; // Example field for filtering by employee ID
  fundId?: string; // Example field for filtering by fund ID
  advanceId?: string; // Example field for filtering by advance ID

  productIds?: string[]; // Example field for filtering by product IDs
  warehouseIds?: string[]; // Example field for filtering by warehouse IDs
  employeeIds?: string[]; // Example field for filtering by employee IDs
  fundCategoryIds?: string[]; // Example field for filtering by fundCategory IDs
  partnerIds?: string[]; // Example field for filtering by partner IDs
  toFundIds?: string[]; // Example field for filtering by fund IDs
}

export type ExcelExportType =
  | "ORDER"
  | "WAREHOUSE_TO_LEADER"
  | "LEADER_TO_WAREHOUSE"
  | "LEADER_TO_WORKER"
  | "WORKER_TO_LEADER"
  | "TAG_OF_CONSIGNMENT"
  | "TAG_OF_ORDER"
  | "TAG_OF_LEADER_TO_WORKER"
  | "LEADER_TO_WAREHOUSE_ORDER"
  | "LEADER_TO_WAREHOUSE_IN_ORDER"
  | "DAO_RUT_TO_WAREHOUSE"
  | "DAO_RUT_TO_WORKER"
  | "WORKER_TO_DAO_RUT";
export type ExcelImportType = "SELL" | "PURCHASE" | "ADJUST_INVENTORY";
export type ExcelTemplateType = "SELL" | "PURCHASE" | "ADJUST_INVENTORY";

export interface PriceUpdate {
  id: string;
  product: string;
  price: number;
  currency: string;
  timestamp: number;
}

export interface SSEClient {
  id: string;
  response: any;
  userId?: string;
  connectedAt: number;
}

export interface ImportExcelResult {
  statusCode?: number;
  message?: string;
  resultFile: string;
  total: number;
  success: number;
  failed: number;
}

export interface ISocketResponse {
  statusCode: number;
  message: string;
  resultFile?: string;
  total?: number;
  success?: number;
  failed?: number;
  duration?: string;
  data?: any;
}

export interface FilterItem {
  id: string;
  name: string;
  type: AttributeType;
  value: number;
}
