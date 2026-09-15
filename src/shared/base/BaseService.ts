import { injectable } from "inversify";
import { Request } from "express";
import {
  ActionMap,
  ApiResponse,
  RequestContext,
} from "@/shared/types/interfaces";
import {
  BaseRepository,
  IFindPaginationOptions,
  MoreQueryOptions,
} from "./BaseRepository";
import { ApiResponseHandler } from "../utils/response.utils";
import {
  BadRequestError,
  IError,
  NotFoundError,
  ValidationError,
} from "../types/errors";
import {
  DeepPartial,
  EntityManager,
  FindManyOptions,
  FindOneOptions,
  In,
  IsNull,
  Not,
  ObjectLiteral,
} from "typeorm";
import { ErrorsMessages } from "../constants/errors";
import { FileHelper } from "../utils/file.helper";
import { RepositoryFactory } from "../utils/repositoryFactory";
import { withTransaction } from "./TransactionManager";
import { TimeFrame } from "./BaseValidator";
import { BaseEntity } from "./BaseEntity";

export interface IFindOptions<T>
  extends FindManyOptions<T>, MoreQueryOptions<T> {
  page?: number;
  size?: number;
}

export type DateInput = Date | string | number | null | undefined;

export type SearchableField<T> = keyof T | (string & {});

@injectable()
export abstract class BaseService<T extends BaseEntity> {
  protected abstract repository: BaseRepository<T>;

  // =====================================================
  // CONFIG
  // =====================================================

  /** Tên entity để ghi operation log (vd: "Order", "Product"). Đặt trong subclass. */
  protected targetEntity?: string;

  /** Bật/tắt ghi operation log tự động. Mặc định: true */
  protected enableOperationLog: boolean = true;

  // Optional unique fields and scope to enforce DB-level uniqueness
  protected uniqueFields?: (keyof T)[];
  protected uniqueScope?: (keyof T)[];

  // Optional searchable fields for text search (keyword)
  protected timeField?: keyof T;
  protected searchableFields?: SearchableField<T>[];
  protected summaryFields?: (keyof T | string)[];

  /**
   * Override trong subclass để disable file attachment
   * @default true
   */
  protected shouldAttachFiles(): boolean {
    return true;
  }

  // Attach files vào 1 entity (tự động gọi nếu shouldAttachFiles = true)
  protected async attachFilesToEntity(entity: T | null): Promise<T | null> {
    if (!entity) return null;

    const grouped = await FileHelper.attachFilesToEntity(entity);

    return {
      ...entity,
      ...grouped,
    };
  }

  // Attach files vào nhiều entities (optimized, 1 query)
  protected async attachFilesToEntities(
    entities: T[],
  ): Promise<(T & Record<string, File[]>)[]> {
    if (!entities || entities.length === 0) return [];

    return await FileHelper.attachFilesToEntities(entities as any[]);
  }

  // Confirm files sau khi tạo entity (tempId → realId)
  protected async confirmEntityFiles(
    tempId: string,
    realId: string,
  ): Promise<void> {
    await FileHelper.confirmEntityFiles(tempId, realId);
  }

  protected collectTrashFileIds(
    data: Record<string, any> | null | undefined,
  ): string[] {
    if (!data || typeof data !== "object") return [];

    const trashFileIds = Array.isArray((data as any).__trashFileIds)
      ? ((data as any).__trashFileIds as unknown[])
      : [];

    delete (data as any).__trashFileIds;

    return Array.from(
      new Set(
        trashFileIds
          .map((fileId) => String(fileId))
          .filter(
            (fileId) => fileId && fileId !== "undefined" && fileId !== "null",
          ),
      ),
    );
  }

  protected async deleteTrashFiles(trashFileIds: string[]): Promise<void> {
    if (!trashFileIds.length) return;

    await FileHelper.deleteFilesByIds(trashFileIds);
  }

  // =====================================================
  // HYDRATE (nạp thêm dữ liệu) — KHÔNG tự động gọi, chỉ khi trả về client
  // =====================================================

  protected async attachMoreDataToEntities(
    entities: T[],
    req?: RequestContext,
  ): Promise<void> {
    // Override in subclass if needed
  }

  protected async attachMoreDataToEntity(
    entity: T,
    req?: RequestContext,
  ): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Gắn actions (canUpdate, canDelete, canExport, ...) vào entity.
   * Override trong subclass để gọi getActions() với logic business riêng.
   * FE dùng _actions để render UI (ẩn/hiện nút, disable, ...).
   * Server cũng dùng chính các hàm canXxx để validate.
   */
  protected async attachActions(
    entity: T & { _actions?: ActionMap },
    req?: RequestContext,
  ): Promise<void> {
    entity._actions = this.getDefaultAction();
  }

  protected getDefaultAction(): ActionMap {
    return {
      update: { can: true },
      delete: { can: true },
    };
  }

  /**
   * Nạp đầy đủ dữ liệu + actions cho 1 entity trước khi trả về client.
   * Server muốn lấy thêm data thì phải chủ động gọi.
   */
  async hydrateEntity(entity: T, req?: RequestContext): Promise<void> {
    await this.attachMoreDataToEntity(entity, req);
    await this.attachActions(entity as T & { _actions?: ActionMap }, req);
    this.restrictCrossStoreActions(entity as T & { _actions?: ActionMap }, req);
  }

  /**
   * Nạp đầy đủ dữ liệu + actions cho danh sách entity.
   */
  async hydrateEntities(entities: T[], req?: RequestContext): Promise<void> {
    await this.attachMoreDataToEntities(entities, req);
    await Promise.all(
      entities.map((entity) =>
        this.attachActions(entity as T & { _actions?: ActionMap }, req),
      ),
    );
    entities.forEach((entity) =>
      this.restrictCrossStoreActions(
        entity as T & { _actions?: ActionMap },
        req,
      ),
    );
  }

  private restrictCrossStoreActions(
    entity: T & { _actions?: ActionMap },
    req?: RequestContext,
  ): void {
    const entityStoreId = (entity as any).storeId as string | undefined;
    if (!entityStoreId || !req) return;
    const currentStoreId = req.storeContext?.storeId;
    if (currentStoreId === entityStoreId) return;
    const reason = currentStoreId
      ? "Không thể thao tác với dữ liệu của cửa hàng khác"
      : "Vui lòng chọn cửa hàng đang thao tác";
    for (const key of [
      "update",
      "delete",
      "assign",
      "unassign",
      "confirm",
      "cancelConfirm",
      "cancel",
      "approve",
      "reject",
      "submit",
      "complete",
      "archive",
      "restore",
      "updateMode",
      "start",
      "arrive",
      "accept",
      "pay",
      "import",
      "remind",
    ] as const) {
      if (entity._actions?.[key]) entity._actions[key] = { can: false, reason };
    }
  }

  // =====================================================
  // QUERY — KHÔNG tự động hydrate để tiết kiệm query
  // =====================================================

  /**
   * Find all
   */
  async findAll(options?: FindManyOptions<T>): Promise<T[]> {
    return this.repository.find(options);
  }

  /**
   *  Phương thức này dùng để tìm kiếm với phân trang và các điều kiện khác nhau
   *  như type, status, khoảng thời gian, và từ khóa tìm kiếm.
   *  - Nếu có type thì chỉ lấy những field tương ứng với type đó
   *  - Nếu có status thì chỉ lấy những field tương ứng với status đó
   *  - Nếu có khoảng thời gian thì chỉ lấy những field tương ứng với khoảng thời gian đó
   *  - Nếu có keyword thì tìm kiếm theo các field có thể tìm kiếm
   *  - Nếu không có keyword thì trả về tất cả các field
   * @param options
   * @returns
   */
  async findAllWithPagination(
    options: IFindOptions<T>,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<ApiResponse<T[]>> {
    let page = options.page || 1;
    const size = options.size || 20;
    const requestedStoreIds = (options as any).storeIds as string[] | undefined;
    const accessibleStoreIds = req?.availableStoreIds;
    const storeIds = Array.isArray(accessibleStoreIds)
      ? Array.isArray(requestedStoreIds)
        ? requestedStoreIds.filter((id) => accessibleStoreIds.includes(id))
        : accessibleStoreIds
      : requestedStoreIds;

    const optionData: IFindPaginationOptions<T> = {
      ...options,
      skip: page,
      take: size,
      order: {},
      searchFields: this.searchableFields,
      summaryFields: this.summaryFields as (keyof T)[] | undefined,
      timeField: this.timeField,
      storeIds,
      accessibleStoreIds,
      moreQuery: { ...options, storeIds, accessibleStoreIds },
    };

    let dataRes = await this.repository.findWithPagination(optionData, manager);

    const totalPages = Math.ceil(dataRes.total / size);
    if (page > totalPages && totalPages > 0) {
      page = totalPages;
      dataRes = await this.repository.findWithPagination(
        { ...optionData, skip: page },
        manager,
      );
    }

    return ApiResponseHandler.getSuccess(
      "OK",
      dataRes.data,
      {
        totalRecords: dataRes.total,
        size: size,
        currentPage: page,
        totalPages: Math.ceil(dataRes.total / size),
      },
      dataRes.summary,
    );
  }

  async getById(
    id: string,
    req?: RequestContext,
    manager?: EntityManager,
  ): Promise<T> {
    const data = await this.findById(id, manager, req);
    if (!data) {
      throw new NotFoundError("Không tìm thấy dữ liệu", [
        { field: "id", message: "Không tìm thấy dữ liệu" },
      ]);
    }
    return data;
  }

  async findById(
    id: string,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<T | null> {
    return this.repository.findById(id, manager, req);
  }

  async findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.repository.findOne(options);
  }

  /**
   * Validate data before create: Logic business riêng cho từng entity hoặc đắp thêm dữ liệu
   * @param data
   * @param manager
   * @param req
   */
  async validateBeforeCreate(
    data: DeepPartial<T>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Sau khi tạo record thành công, thực hiện các hành động bổ sung
   * VD: Gửi thông báo, tính lại dữ liệu entity liên quan, v.v.
   * @param data
   * @param manager
   * @param req
   */
  async actionAfterCreate(
    data: T,
    manager: EntityManager,
    req?: RequestContext,
    _inputData?: DeepPartial<T>,
  ): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Create
   */
  async create(
    data: DeepPartial<T>,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<T> {
    const trashFileIds = this.collectTrashFileIds(data as any);
    const inputData = { ...data };

    const runWithManager = async (manager: EntityManager) => {
      await this.validateBeforeCreate(data, manager, req);
      // perform unique check if configured
      if (this.uniqueFields && this.uniqueFields.length > 0) {
        const errs = await this.checkExistInDb(
          data as any,
          this.uniqueFields as any,
          (this.uniqueScope as any) || [],
        );
        if (errs.length > 0) throw new ValidationError("input.invalid", errs);
      }
      // perform reference existence check if applicable
      const refErrs = await this.checkReferencesInDb?.(data, manager);
      if (refErrs && refErrs.length > 0)
        throw new ValidationError("input.invalid", refErrs);
      const createdEntity = await this.repository.create(data, manager, req);
      await this.actionAfterCreate(createdEntity, manager, req, inputData);
      const fullData = await this.repository.findById(
        createdEntity.id,
        manager,
      );

      await this.deleteTrashFiles(trashFileIds);
      return fullData || createdEntity;
    };

    return manager
      ? await runWithManager(manager)
      : await withTransaction(runWithManager);
  }

  async validateBeforeCreateMany(
    data: DeepPartial<T>[],
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    // Override in subclass if needed
  }

  async actionAfterCreateMany(
    data: T[],
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {}

  async createMany(
    data: DeepPartial<T>[],
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<T[]> {
    const trashFileIds = data.flatMap((item) =>
      this.collectTrashFileIds(item as any),
    );

    const runWithManager = async (manager: EntityManager) => {
      await this.validateBeforeCreateMany(data, manager, req);
      // perform unique check if configured
      if (this.uniqueFields && this.uniqueFields.length > 0) {
        const errs = await this.checkExistInDb(
          data as any,
          this.uniqueFields as any,
          (this.uniqueScope as any) || [],
        );
        if (errs.length > 0) throw new ValidationError("input.invalid", errs);
      }
      // perform reference existence check if applicable
      const refErrs = await this.checkReferencesInDb?.(data, manager);
      if (refErrs && refErrs.length > 0)
        throw new ValidationError("input.invalid", refErrs);
      const createdEntity = await this.repository.createMany(
        data,
        manager,
        req,
      );
      await this.actionAfterCreateMany(createdEntity, manager, req);
      const fullData = await this.repository.findByIds(
        createdEntity.map((e) => e.id),
        manager,
      );

      await this.deleteTrashFiles(trashFileIds);

      return fullData || createdEntity;
    };

    return manager
      ? await runWithManager(manager)
      : await withTransaction(runWithManager);
  }

  /**
   * Validate data before update: Logic business riêng cho từng entity hoặc đắp thêm dữ liệu
   * @param id
   * @param data
   * @param manager
   * @param req
   */
  async validateBeforeUpdate(
    id: string,
    data: DeepPartial<T>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Sau khi cập nhật record thành công, thực hiện các hành động bổ sung
   */
  async actionAfterUpdate(
    data: T,
    manager: EntityManager,
    req?: RequestContext,
    _inputData?: DeepPartial<T>,
  ): Promise<void> {
    // Override in subclass if needed
  }

  async update(
    id: string,
    data: DeepPartial<T>,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<T | null> {
    const storeId = req?.storeContext?.storeId;
    const trashFileIds = this.collectTrashFileIds(data as any);
    const inputData = { ...data };

    if (data.isDefault && (data as any).name) delete (data as any).name;

    const runWithManager = async (manager: EntityManager) => {
      const entity = await this.getById(id, req, manager);

      await this.validateBeforeUpdate(id, data, manager, req);

      if (!entity) {
        throw new NotFoundError("Không tìm thấy dữ liệu", "id");
      }

      if ((entity as any).storeId && !storeId) {
        throw new BadRequestError("Vui lòng chọn cửa hàng đang thao tác");
      }
      const isFund = (this.repository as any).entityClass?.name === "Fund";
      if ((entity as any).storeId && (entity as any).storeId !== storeId) {
        throw new BadRequestError(
          "Dữ liệu không thuộc công ty của bạn, không thể cập nhật",
        );
      }

      if (
        Object.prototype.hasOwnProperty.call(data, "storeId") &&
        (data as any).storeId !== (entity as any).storeId &&
        !(
          isFund &&
          ((data as any).storeId == null || (entity as any).storeId == null)
        )
      ) {
        throw new BadRequestError(
          "Không thể chuyển dữ liệu sang cửa hàng khác",
        );
      }

      // perform unique check if configured (exclude self by providing id)
      if (this.uniqueFields && this.uniqueFields.length > 0) {
        // Merge các giá trị scope từ entity cũ nếu chúng không có trong data
        const dataWithScope: any = { ...data, id };
        if (this.uniqueScope && this.uniqueScope.length > 0) {
          for (const scopeField of this.uniqueScope) {
            if (dataWithScope[scopeField] === undefined) {
              dataWithScope[scopeField] = entity[scopeField];
            }
          }
        }

        const errs = await this.checkExistInDb(
          dataWithScope,
          this.uniqueFields,
          this.uniqueScope || [],
        );
        if (errs.length > 0) throw new ValidationError("input.invalid", errs);
      }
      // perform reference existence check for update
      const refErrs = await this.checkReferencesInDb({ ...data, id }, manager);
      if (refErrs && refErrs.length > 0)
        throw new ValidationError("input.invalid", refErrs);

      const updatedEntity = await this.repository.update(id, data, manager);

      if (updatedEntity) {
        await this.actionAfterUpdate(updatedEntity, manager, req, inputData);
      }

      const fullData = await this.repository.findById(
        updatedEntity?.id || id,
        manager,
      );

      await this.deleteTrashFiles(trashFileIds);

      return fullData;
    };

    return manager
      ? await runWithManager(manager)
      : await withTransaction(runWithManager);
  }

  /**
   * Validate data before delete: Logic business riêng cho từng entity hoặc đắp thêm dữ liệu
   * @param data
   * @param manager
   * @param req
   */
  async validateBeforeDelete(
    data: T,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    // Override in subclass if needed
  }

  async actionAfterDelete(
    data: T,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    // Override in subclass if needed
  }

  async delete(
    id: string,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<boolean> {
    const storeId = req?.storeContext?.storeId;
    const runWithManager = async (manager: EntityManager) => {
      const entity = await this.getById(id, req, manager);
      if (!entity) throw new NotFoundError("Không tìm thấy dữ liệu cần xóa");

      if ((entity as any).storeId && !storeId) {
        throw new BadRequestError("Vui lòng chọn cửa hàng đang thao tác");
      }
      if ((entity as any).storeId && (entity as any).storeId !== storeId) {
        throw new BadRequestError(
          "Dữ liệu không thuộc công ty của bạn, không thể xóa",
        );
      }
      await this.validateBeforeDelete(entity, manager, req);
      const result = await this.repository.delete(id, manager);
      await this.actionAfterDelete(entity, manager, req);
      return result;
    };

    return manager
      ? await runWithManager(manager)
      : await withTransaction(runWithManager);
  }

  async deleteMany(
    ids: string[],
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<boolean> {
    const storeId = req?.storeContext?.storeId;
    const runWithManager = async (manager: EntityManager) => {
      const entities = await this.repository.findByIds(
        ids,
        manager,
        req as any,
      );
      for (const entity of entities) {
        if ((entity as any).storeId && !storeId) {
          throw new BadRequestError("Vui lòng chọn cửa hàng đang thao tác");
        }
        if ((entity as any).storeId && (entity as any).storeId !== storeId) {
          throw new BadRequestError(
            "Dữ liệu không thuộc công ty của bạn, không thể xóa",
          );
        }

        await this.validateBeforeDelete(entity, manager, req);
      }
      const result = await this.repository.deleteMany(ids, manager);
      for (const entity of entities) {
        await this.actionAfterDelete(entity, manager, req);
      }
      return result > 0;
    };

    return manager
      ? await runWithManager(manager)
      : await withTransaction(runWithManager);
  }

  /**
   * Count
   */
  async count(options?: FindManyOptions<T>): Promise<number> {
    return this.repository.count(options);
  }

  /**
   * Check exists
   */
  async exists(id: string, manager?: EntityManager): Promise<boolean> {
    return this.repository.exists({ id } as any, manager);
  }

  protected checkDuplicate<
    T extends Record<string, any>,
    K extends readonly (keyof T)[],
    S extends readonly (keyof T)[],
  >(items: T[], fields: K, prefix: string, scopes?: S): IError[] {
    const errors: IError[] = [];

    /**
     * field -> scopeKey -> value -> index
     */
    const seenMap = new Map<string, Map<string, Map<any, number>>>();

    // init
    for (const field of fields) {
      seenMap.set(field as string, new Map());
    }

    items.forEach((item, index) => {
      // tạo composite scope key
      const scopeKey = scopes?.length
        ? scopes.map((k) => item[k]).join("__")
        : "__global__";

      // nếu có scope mà thiếu value → bỏ qua
      if (
        scopes?.length &&
        scopes.some(
          (k) => item[k] === null || item[k] === undefined || item[k] === "",
        )
      ) {
        return;
      }

      fields.forEach((field) => {
        const fieldKey = field as string;
        const value = item[fieldKey];

        // bỏ qua null / undefined / empty string
        if (value === null || value === undefined || value === "") return;

        const fieldMap = seenMap.get(fieldKey)!;

        if (!fieldMap.has(scopeKey)) {
          fieldMap.set(scopeKey, new Map());
        }

        const scopedSeen = fieldMap.get(scopeKey)!;

        if (scopedSeen.has(value)) {
          errors.push({
            field: `${prefix}.${index}.${fieldKey}`,
            message: "Giá trị trùng lặp",
          });
        } else {
          scopedSeen.set(value, index);
        }
      });
    });

    return errors;
  }

  /**
   * Check existence in DB for given fields with optional scope fields.
   * Example: fields = ["email","phone"], scope = ["partnerId"]
   * Will query (email AND partnerId) OR (phone AND partnerId)
   * Returns an array of IError (empty when no conflicts)
   */
  protected async checkExistInDb<T extends Record<string, any>>(
    items: T[] | T,
    fields: (keyof T)[],
    scopeFields: (keyof T)[] = [],
  ): Promise<IError[]> {
    const itemArray = Array.isArray(items) ? items : [items];
    const errors: IError[] = [];

    for (let i = 0; i < itemArray.length; i++) {
      const item = itemArray[i];

      const orConditions: any[] = [];

      for (const field of fields) {
        const value = item[field as string];
        if (value == null || value === "") continue;

        orConditions.push({ [field as string]: value });
      }

      if (!orConditions.length) continue;

      const baseWhere: any = { deletedAt: null };

      for (const s of scopeFields) {
        if (item[s as string] != null) {
          baseWhere[s as string] = item[s as string];
        }
      }

      if (item.id) baseWhere.id = Not(item.id);

      const found = await this.repository.findByOptions({
        where: orConditions.map((or) => ({
          ...baseWhere,
          ...or,
        })),
      } as any);

      if (found.length > 0) {
        for (const field of fields) {
          const exists = found.find((f: any) => {
            const val = item[field];
            return val != null && f[field] === val;
          });
          if (exists)
            errors.push({
              field: String(field),
              message: "Giá trị đã tồn tại",
            });
        }
      }
    }

    return errors;
  }

  /**
   * Check foreign-key references in DB for tenant entities.
   * Batches checks per related-entity to minimize queries (1 query per related entity).
   */
  protected async checkReferencesInDb(
    items: DeepPartial<T> | Partial<T> | DeepPartial<T>[] | Partial<T>[],
    manager?: EntityManager,
  ): Promise<IError[]> {
    const itemArray = Array.isArray(items) ? items : [items];
    const errors: IError[] = [];
    // get root repo metadata
    const rootRepo = await (this.repository as any).getRepository(manager);
    const entityMetadata = rootRepo.metadata;

    // map possible fk keys -> related entity name
    const relationIdToEntityMap: Record<string, string> = {};
    entityMetadata.relations.forEach((relation: any) => {
      const joinColumn = relation.joinColumns?.[0];
      const propKey = `${relation.propertyName}Id`;
      if (joinColumn?.databaseName)
        relationIdToEntityMap[joinColumn.databaseName] =
          relation.inverseEntityMetadata.name;
      relationIdToEntityMap[propKey] = relation.inverseEntityMetadata.name;
    });

    // collect ids per related entity and track occurrences
    const occurrences: Record<
      string,
      Map<string, Array<{ index: number; field: string }>>
    > = {};

    for (let i = 0; i < itemArray.length; i++) {
      const item: any = itemArray[i];
      for (const key of Object.keys(item)) {
        if (!key.endsWith("Id")) continue;
        const relatedEntity = relationIdToEntityMap[key];
        if (!relatedEntity) continue;
        const idValue = item[key];
        if (!idValue) continue;

        occurrences[relatedEntity] = occurrences[relatedEntity] || new Map();
        const mapForEntity = occurrences[relatedEntity];
        const idStr = String(idValue);
        if (!mapForEntity.has(idStr)) mapForEntity.set(idStr, []);
        mapForEntity.get(idStr)!.push({ index: i, field: key });
      }
    }

    if (Object.keys(occurrences).length === 0) return errors;

    const repoMap = RepositoryFactory.getRepositories(manager);

    // For each related entity, batch check IDs
    await Promise.all(
      Object.keys(occurrences).map(async (relatedEntity) => {
        const idMap = occurrences[relatedEntity];
        const ids = Array.from(idMap.keys());
        const repo = repoMap[relatedEntity];
        if (!repo) {
          // mark all as not found
          idMap.forEach((arr) => {
            arr.forEach((occ) =>
              errors.push({
                field: occ.field,
                message: "Repository chưa được thêm vào Factory",
              }),
            );
          });
          return;
        }

        // query existing ids in tenant schema
        const found = await repo.find({
          where: { id: In(ids as any), deletedAt: IsNull() } as any,
        });

        const foundIds = new Set(found.map((f: any) => String(f.id)));

        idMap.forEach((arr, id) => {
          if (!foundIds.has(id)) {
            arr.forEach((occ) =>
              errors.push({
                field: occ.field,
                message: "Không tìm thấy dữ liệu",
              }),
            );
          }
        });
      }),
    );

    return errors;
  }

  getEarliestDate(d1?: DateInput, d2?: DateInput): Date | null {
    if (d1 == null && d2 == null) return null;

    const t1 = d1 != null ? new Date(d1).getTime() : null;
    const t2 = d2 != null ? new Date(d2).getTime() : null;

    if (t1 == null && t2 == null) {
      return new Date(0); // epoch
    }

    if (t1 == null) return new Date(t2!);
    if (t2 == null) return new Date(t1);

    return new Date(Math.min(t1, t2));
  }

  collectUniqueIds(ids: Array<string | null | undefined>): string[] {
    return Array.from(
      new Set(
        ids.filter(
          (id): id is string => typeof id === "string" && id.trim() !== "",
        ),
      ),
    );
  }

  checkInFrame(
    value: Date,
    timeFrame?: TimeFrame | null,
    tz = "Asia/Ho_Chi_Minh",
  ): boolean {
    if (!timeFrame) return true;
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).formatToParts(value);
    const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
    const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
    const now = `${hh}:${mm}`;

    const { start, end } = timeFrame;

    // Không giới hạn
    if (!start && !end) {
      return true;
    }

    // Chỉ có giờ bắt đầu
    if (start && !end) {
      return now >= start;
    }

    // Chỉ có giờ kết thúc
    if (!start && end) {
      return now <= end;
    }

    // Có đủ khoảng thời gian
    if (start && end) {
      return now >= start && now <= end;
    }

    return false;
  }

  checkInAnyFrame(value: Date, timeFrames: TimeFrame[]): boolean {
    if (!timeFrames || timeFrames.length === 0) return true;

    return timeFrames.some((frame) => this.checkInFrame(value, frame));
  }

  /**
   * Chuyển Express Request → RequestContext (dùng trong service thay vì raw Request).
   * Tách biệt để service không phụ thuộc trực tiếp vào Express.
   */
  getReqContext(req?: Request): RequestContext | undefined {
    return req
      ? {
          query: req.query,
          permissions: (req as any).permissions,
          userContext: (req as any).userContext,
          storeContext: (req as any).storeContext,
          availableStoreIds: (req as any).availableStoreIds,
          storePermissions: (req as any).storePermissions,
          permissionModule: (req as any).permissionModule,
        }
      : undefined;
  }

  protected createErrorKeyForArray(
    arrayField: string,
    field: string,
    index: number,
  ): string {
    return `${arrayField}.${index}.${field}`;
  }
}
