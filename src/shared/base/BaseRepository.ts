import {
  Repository,
  EntityTarget,
  FindOptionsWhere,
  DeepPartial,
  EntityManager,
  FindManyOptions,
  IsNull,
  DataSource,
  FindOneOptions,
  FindOptionsRelations,
  SelectQueryBuilder,
  Brackets,
  ObjectLiteral,
  In,
} from "typeorm";
import { createHash } from "crypto";
import DatabaseConfig from "@/config/database";
import { BadRequestError, NotFoundError } from "@/shared/types/errors";
import { injectable } from "inversify";
import { generateCode } from "../utils/code.utils";
import logger from "../utils/logger";
import fs from "fs/promises";
import {
  OPERATOR_MAP,
  rangeSuffixes,
  RequestContext,
} from "../types/interfaces";
import { Request } from "express";
import { FileStatus } from "@/database/models/File";

export interface MoreQueryOptions<T> {
  keyword?: string; // Keyword for text search
  searchFields?: (keyof T | string)[]; // Fields to search in
  timeField?: keyof T; // Specific date field to apply the date range filter
  type?: string; // Example field for filtering by type
  status?: string; // Example field for filtering by status
  summaryFields?: (keyof T)[]; // Các trường có kiểu số cần tính tổng (ví dụ: ['plannedHours', 'actualHours'])
  startAt?: Date; // Example field for filtering by date range
  endAt?: Date; // Example field for filtering by date range
  sortBy?: string; // Field to sort by
  sortOrder?: "ASC" | "DESC"; // Sort type
  isFinished?: boolean; // Example field for filtering by completion status
  isActive?: boolean; // Example field for filtering by active status
  ids?: string[]; // Filter by multiple IDs
  creatorIds?: string[]; // Filter by multiple creator IDs
  updaterIds?: string[]; // Filter by multiple updater IDs
  storeIds?: string[]; // Filter by multiple store IDs
  accessibleStoreIds?: string[]; // Store IDs allowed by the active module permission
  storeId?: string; // Example field for filtering by store ID
  states?: string[];
  wards?: string[];
  filterOptions?: (keyof T)[]; // Additional filter options

  useFullDetail?: boolean; // Flag to indicate if full detail should be fetched
}

export interface IFindPaginationOptions<T>
  extends FindManyOptions<T>, MoreQueryOptions<T> {
  moreQuery?: any; // Additional complex queries
}

@injectable()
export abstract class BaseRepository<T extends ObjectLiteral> {
  protected abstract entityClass: EntityTarget<T>;
  protected dataSource: DataSource;
  protected enableFileAttachment: boolean = true; // Có thể override trong repo con
  /**
   * Cho phép nhiều file cùng category cho 1 entity
   * - false (default): Mỗi entity chỉ được 1 file/category tại 1 thời điểm (giữ file mới nhất)
   * - true: Không giới hạn số file
   */
  protected multipleFile: boolean = false;
  /**
   * Khi multipleFile = true, danh sách category vẫn chỉ giữ 1 file (single-file).
   * VD: ['logo', 'avatar'] → logo và avatar chỉ giữ 1 file, các category khác giữ nhiều file.
   * Khi multipleFile = false, property này bị bỏ qua (tất cả category đều single-file).
   */
  protected singleFileCategories?: string[];
  /**
   * Danh sách các trường nested (object[] hoặc object) trên entity mà
   * repo con có thể khai báo để BaseRepository gắn files cho các phần tử con.
   *
   * Hỗ trợ path notation để chỉ định chính xác entity cần load files:
   * - ['variants'] → gắn file cho từng variant
   * - ['lines.productId'] → gắn file cho productId trong mỗi orderLine
   * - ['lines', 'lines.productId'] → gắn file cho cả orderLine và productId
   *
   * Nếu không khai báo, repository sẽ fallback quét mọi trường để phát hiện mảng object có `id`.
   *
   * ⚠️ LƯU Ý: Nested entities LUÔN chỉ giữ 1 file/category (bất kể multipleFile của parent)
   */
  protected nestedFileFields?: string[];

  /** JSONB address fields that can be filtered by province and ward. */
  protected addressFields?: string[];

  /**
   * Select fields cho detail query (findById, findOne)
   * Mặc định sẽ lấy đầy đủ thông tin
   */
  protected selectedFields?: any;
  /**
   * Select fields cho list query (find, findAll, findWithPagination)
   * Nếu không được set, sẽ fallback về selectedFields
   * Dùng để giảm dữ liệu trả về khi query danh sách
   */
  protected selectedFieldsForList?: any;

  /**
   * Relations cho detail query (findById, findOne)
   * Mặc định sẽ join đầy đủ thông tin
   */
  protected relations: FindOptionsRelations<T>;
  /**
   * Relations cho list query (find, findAll, findWithPagination)
   * Nếu không được set, sẽ fallback về relations
   * Dùng để giảm dữ liệu trả về khi query danh sách
   */
  protected relationsForList?: FindOptionsRelations<T>;

  protected sortOrderScope?: keyof T; // Các trường dùng để phân scope khi tính sortOrder

  protected async extendQueryBuilder(
    qb: SelectQueryBuilder<T>,
    options: IFindPaginationOptions<T>,
  ): Promise<void> {
    // mặc định không làm gì — repo con override khi cần join/group/select thêm
  }

  private isTextLikeColumnType(columnType: unknown): boolean {
    const normalizedType =
      typeof columnType === "string"
        ? columnType.toLowerCase()
        : typeof columnType === "function"
          ? columnType.name.toLowerCase()
          : String(columnType).toLowerCase();

    return [
      "string",
      "text",
      "varchar",
      "char",
      "character",
      "character varying",
      "citext",
    ].includes(normalizedType);
  }

  /**
   * Recursively join relations from FindOptionsRelations config
   * Ví dụ: { variants: { options: true, unit: true } }
   */
  private buildJoinAlias(parentAlias: string, relationKey: string): string {
    const rawAlias = `${parentAlias}_${relationKey}`;

    // PostgreSQL identifier limit is 63 chars; keep aliases short and stable.
    if (rawAlias.length <= 50) return rawAlias;

    const hash = createHash("sha1").update(rawAlias).digest("hex").slice(0, 8);
    const shortParent = parentAlias.slice(0, 20);
    const shortRelation = relationKey.slice(0, 20);

    return `${shortParent}_${shortRelation}_${hash}`.slice(0, 63);
  }

  private joinRelations(
    qb: SelectQueryBuilder<T>,
    relations: FindOptionsRelations<T> | boolean,
    parentAlias: string = "entity",
  ): void {
    if (!relations || typeof relations === "boolean") return;

    Object.keys(relations).forEach((relationKey) => {
      const relationValue = (relations as any)[relationKey];
      const relationAlias = this.buildJoinAlias(parentAlias, relationKey);
      const relationPath = `${parentAlias}.${relationKey}`;

      const isAlreadyJoined = (qb as any).expressionMap?.joinAttributes?.some(
        (join: any) =>
          join?.entityOrProperty === relationPath ||
          join?.alias?.name === relationAlias,
      );

      if (!isAlreadyJoined) {
        qb.leftJoinAndSelect(relationPath, relationAlias);
      }

      // Đệ quy nếu có nested relations
      if (relationValue && typeof relationValue === "object") {
        this.joinRelations(qb, relationValue, relationAlias);
      }
    });
  }

  /**
   * Apply a TypeORM select tree to a query-builder query.
   * `leftJoinAndSelect` selects every column by default, so relation configs
   * must be applied explicitly after all joins have been created.
   */
  private applySelectTree(
    qb: SelectQueryBuilder<T>,
    selectTree: any,
    parentAlias = "entity",
  ): void {
    if (!selectTree || typeof selectTree !== "object") return;

    const rootMetadata = (qb as any).expressionMap?.mainAlias?.metadata;
    if (!rootMetadata) return;

    const selections: string[] = [];

    const addColumns = (metadata: any, alias: string, fields: any) => {
      if (!fields || typeof fields !== "object") return;

      for (const [propertyName, value] of Object.entries(fields)) {
        const column = metadata.findColumnWithPropertyName(propertyName);
        if (column && value === true) {
          selections.push(`${alias}.${column.propertyName}`);
          continue;
        }

        const relation = metadata.findRelationWithPropertyPath(propertyName);
        if (!relation || value === false || value == null) continue;

        const relationAlias = this.buildJoinAlias(alias, propertyName);
        const relationIsJoined = (qb as any).expressionMap.joinAttributes?.some(
          (join: any) => join?.alias?.name === relationAlias,
        );
        if (!relationIsJoined) continue;

        if (value === true) {
          for (const relationColumn of relation.inverseEntityMetadata.columns) {
            selections.push(`${relationAlias}.${relationColumn.propertyName}`);
          }
          continue;
        }

        addColumns(relation.inverseEntityMetadata, relationAlias, value);
      }
    };

    addColumns(rootMetadata, parentAlias, selectTree);
    if (selections.length > 0) qb.select(selections);
  }

  // sửa trong BaseRepository
  protected mapRawEntities(rawAndEntities: {
    entities: T[];
    raw: any[];
  }): any[] {
    return rawAndEntities.entities.map((entity, index) => {
      const raw = rawAndEntities.raw[index];
      const extras: any = {};
      const entityRecord = entity as Record<string, unknown>;

      // auto map các alias có prefix entity_
      Object.keys(raw).forEach((key) => {
        if (key.startsWith("entity_total")) {
          const field = key.replace("entity_", "");
          // Chỉ map field extra, tránh ghi đè cột total* đã có trong entity
          // vì giá trị raw numeric từ Postgres có thể là string (vd "0.00").
          if (!(field in entityRecord)) {
            extras[field] = raw[key];
          }
        }
      });

      return { ...entity, ...extras };
    });
  }

  constructor() {
    // Initialize repository in postConstruct or through method call
    this.dataSource = DatabaseConfig;
  }

  public getRepository(manager?: EntityManager): Repository<T> {
    if (manager) {
      return manager.getRepository(this.entityClass);
    }
    return this.dataSource.getRepository(this.entityClass);
  }

  /**
   * Find many
   */
  async find(
    options?: FindManyOptions<T>,
    manager?: EntityManager,
  ): Promise<T[]> {
    const repo = this.getRepository(manager);

    // Ưu tiên options, sau đó dùng ForList, cuối cùng fallback
    const finalOptions: FindManyOptions<T> = {
      ...options,
      select:
        options?.select || this.selectedFieldsForList || this.selectedFields,
      relations: options?.relations || this.relationsForList || this.relations,
    };

    const entities = await repo.find(finalOptions);

    // Auto-attach files if enabled
    if (this.enableFileAttachment) {
      return await this.attachFilesToEntities(entities);
    }

    return entities;
  }

  /**
   * Find one
   */
  async findOne(
    options: FindOneOptions<T>,
    manager?: EntityManager,
  ): Promise<T | null> {
    const repo = this.getRepository(manager);

    // Ưu tiên options, sau đó dùng selectedFields và relations cho detail
    const finalOptions: FindOneOptions<T> = {
      ...options,
      select: options?.select || this.selectedFields,
      relations: options?.relations || this.relations,
    };

    const entity = await repo.findOne(finalOptions);

    // Auto-attach files if enabled
    if (entity && this.enableFileAttachment) {
      return await this.attachFilesToEntity(entity);
    }

    return entity;
  }

  async getById(
    id: string,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<T> {
    const data = await this.findById(id, manager, req);
    if (!data) {
      throw new NotFoundError("Không tìm thấy dữ liệu", "id");
    }
    return data;
  }

  // Soft delete aware methods
  async findById(
    id: string,
    manager?: EntityManager,
    req?: RequestContext,
    includeDeleted: boolean = false,
  ): Promise<T | null> {
    const repo = this.getRepository(manager);

    // Dùng query builder khi có extendQueryBuilder
    const qb = repo.createQueryBuilder("entity");
    qb.where("entity.id = :id", { id });

    // Xử lý soft delete
    if (!includeDeleted) {
      qb.andWhere("entity.deletedAt IS NULL");
    } else {
      qb.withDeleted();
    }

    const metadata = repo.metadata;
    const accessibleStoreIds = req?.availableStoreIds;
    if (
      Array.isArray(accessibleStoreIds) &&
      metadata.columns.some((column) => column.propertyName === "storeId")
    ) {
      if (accessibleStoreIds.length === 0) qb.andWhere("1 = 0");
      else {
        qb.andWhere(
          "(entity.storeId IN (:...accessibleStoreIds) OR entity.storeId IS NULL)",
          { accessibleStoreIds },
        );
      }
    }

    // Join relations nếu có (đệ quy cho nested relations)
    if (this.relations) {
      this.joinRelations(qb, this.relations, "entity");
    }

    this.applySelectTree(qb, this.selectedFields, "entity");

    // Gọi extendQueryBuilder để thêm các select/extra fields
    await this.extendQueryBuilder(qb, {
      moreQuery: {
        ...(req?.query || {}),
        accessibleStoreIds: req?.availableStoreIds,
      },
    });

    // Nếu có extra select/group thì mapRawEntities, ngược lại getOne
    const hasGroupBy = (qb as any).expressionMap?.groupBys?.length > 0;
    const hasExtraSelect = (qb as any).expressionMap?.selects?.some((s: any) =>
      s.aliasName?.startsWith("entity_"),
    );

    let entity: T | null;
    if (hasGroupBy || hasExtraSelect) {
      const rawAndEntities = await qb.getRawAndEntities();
      const data = this.mapRawEntities(rawAndEntities);
      entity = data[0] || null;
    } else {
      entity = await qb.getOne();
    }

    // Auto-attach files from MasterFile
    if (entity && this.enableFileAttachment) {
      return await this.attachFilesToEntity(entity);
    }

    return entity;
  }

  async findByIds(
    ids: string[],
    manager?: EntityManager,
    req?: Request,
    includeDeleted: boolean = false,
  ): Promise<T[]> {
    if (!ids || ids.length === 0) return [];

    const repo = this.getRepository(manager);

    // ================== QUERY BUILDER MODE ==================
    const qb = repo.createQueryBuilder("entity");

    qb.where("entity.id IN (:...ids)", { ids });

    // Soft delete
    if (!includeDeleted) {
      qb.andWhere("entity.deletedAt IS NULL");
    } else {
      qb.withDeleted();
    }

    // Relations
    const accessibleStoreIds = req?.availableStoreIds;
    if (
      Array.isArray(accessibleStoreIds) &&
      repo.metadata.columns.some((column) => column.propertyName === "storeId")
    ) {
      if (accessibleStoreIds.length === 0) qb.andWhere("1 = 0");
      else {
        qb.andWhere(
          "(entity.storeId IN (:...accessibleStoreIds) OR entity.storeId IS NULL)",
          { accessibleStoreIds },
        );
      }
    }
    if (this.relations) {
      this.joinRelations(qb, this.relations, "entity");
    }

    this.applySelectTree(qb, this.selectedFields, "entity");

    // Extend
    await this.extendQueryBuilder(qb, {
      moreQuery: { ...(req?.query || {}), accessibleStoreIds },
    });

    const hasGroupBy = (qb as any).expressionMap?.groupBys?.length > 0;
    const hasExtraSelect = (qb as any).expressionMap?.selects?.some((s: any) =>
      s.aliasName?.startsWith("entity_"),
    );

    let entities: T[] = [];

    if (hasGroupBy || hasExtraSelect) {
      const rawAndEntities = await qb.getRawAndEntities();
      entities = this.mapRawEntities(rawAndEntities);
    } else {
      entities = await qb.getMany();
    }

    // Attach files
    if (this.enableFileAttachment && entities.length) {
      entities = await Promise.all(
        entities.map((e) => this.attachFilesToEntity(e)),
      );
    }

    return entities;
  }

  async findAll(
    manager?: EntityManager,
    includeDeleted: boolean = false,
  ): Promise<T[]> {
    const options: FindManyOptions<T> = {
      select: this.selectedFieldsForList || this.selectedFields,
      relations: this.relationsForList || this.relations,
    };
    if (!includeDeleted) {
      options.where = { deletedAt: IsNull() } as any;
    } else {
      options.withDeleted = true;
    }
    const entities = await this.getRepository(manager).find(options);

    // Auto-attach files from MasterFile
    if (this.enableFileAttachment) {
      return await this.attachFilesToEntities(entities);
    }
    return entities;
  }

  async findWithPagination(
    options: IFindPaginationOptions<T>,
    manager?: EntityManager,
    includeDeleted = false,
  ): Promise<{ data: T[]; total: number; summary?: any }> {
    const page = options.skip || 1;
    const size = options.take || 20;

    const repository = this.getRepository(manager);
    const entityMetadata = repository.metadata;
    const qb = repository.createQueryBuilder("entity");

    // Join relations: ưu tiên relationsForList cho list query (trừ khi useFullDetail)
    const defaultRelations = options.useFullDetail
      ? this.relations
      : this.relationsForList || this.relations;
    const allRelations = { ...defaultRelations, ...options.relations };
    if (allRelations && Object.keys(allRelations).length > 0) {
      this.joinRelations(qb, allRelations, "entity");
    }

    const selectedFields =
      options.select ||
      (options.useFullDetail
        ? this.selectedFields
        : this.selectedFieldsForList || this.selectedFields);
    this.applySelectTree(qb, selectedFields, "entity");

    if (options.keyword) {
      let textSearchableFields: string[] = [];

      const resolveFieldAlias = (field: string): string | null => {
        if (!field.includes(".")) return `entity.${field}`;

        const fieldParts = field.split(".");
        const rootField = fieldParts[0];

        // Hỗ trợ JSON path: creatorSnapshot.name, stockMetadata.total.quantity...
        const rootColumn =
          repository.metadata.findColumnWithPropertyName(rootField);
        if (rootColumn && fieldParts.length > 1) {
          const rootType =
            typeof rootColumn.type === "string"
              ? rootColumn.type.toLowerCase()
              : typeof rootColumn.type === "function"
                ? rootColumn.type.name.toLowerCase()
                : String(rootColumn.type).toLowerCase();

          const isJsonLike = ["json", "jsonb", "simple-json"].includes(
            rootType,
          );
          if (isJsonLike) {
            const jsonPath = fieldParts.slice(1);
            const quotedRootField = `"entity"."${rootField}"`;

            if (jsonPath.length === 1) {
              return `${quotedRootField}->>'${jsonPath[0]}'`;
            }

            return `${quotedRootField}#>>'{${jsonPath.join(",")}}'`;
          }
        }

        const parts = [...fieldParts];
        const column = parts.pop();

        if (!column || parts.length === 0) return null;

        let currentAlias = "entity";

        for (const relation of parts) {
          const relationAlias = this.buildJoinAlias(currentAlias, relation);
          const isJoined = (qb as any).expressionMap.joinAttributes.some(
            (j: any) => j.alias?.name === relationAlias,
          );

          if (!isJoined) return null; // relation chưa join → bỏ qua

          currentAlias = relationAlias;
        }

        return `${currentAlias}.${column}`;
      };

      // ===== 1. Xác định danh sách field cần search =====
      if (options.searchFields && options.searchFields.length > 0) {
        textSearchableFields = options.searchFields
          .map((f) => resolveFieldAlias(String(f)))
          .filter(Boolean) as string[];
      } else {
        const autoDetectedFields = repository.metadata.columns
          .filter((column) => this.isTextLikeColumnType(column.type))
          .map((column) => `entity.${column.propertyName}`);

        textSearchableFields.push(...autoDetectedFields);

        // Thêm field từ relations (name, code)
        const allRelations = { ...this.relations, ...options.relations };
        if (allRelations) {
          Object.keys(allRelations).forEach((relationKey) => {
            ["name", "code"].forEach((col) => {
              const resolved = resolveFieldAlias(`${relationKey}.${col}`);
              if (resolved) textSearchableFields.push(resolved);
            });
          });
        }
      }

      // ===== 2. Apply WHERE search =====
      if (textSearchableFields.length > 0) {
        qb.andWhere(
          new Brackets((qb1) => {
            textSearchableFields.forEach((field, idx) => {
              const fieldExpression = `CAST(${field} AS TEXT)`;

              const condition = `
                      unaccent(LOWER(${fieldExpression}))
                      ILIKE unaccent(LOWER(:keyword))
                    `;

              if (idx === 0) {
                qb1.where(condition, { keyword: `%${options.keyword}%` });
              } else {
                qb1.orWhere(condition);
              }
            });
          }),
        );
      }
    }

    await this.extendQueryBuilder(qb, options);

    // ===== JSONB address filters =====
    const addressFilterSource = options.moreQuery || options;
    const normalizeQueryArray = (value: unknown): string[] => {
      const values = Array.isArray(value) ? value : [value];
      return values
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    };

    const addressColumns = (this.addressFields || [])
      .map((field) => entityMetadata.findColumnWithPropertyName(field))
      .filter(Boolean);

    if (
      addressColumns.length > 0 &&
      addressFilterSource &&
      typeof addressFilterSource === "object"
    ) {
      const addressFilters = [
        {
          key: "state",
          values: normalizeQueryArray((addressFilterSource as any).states),
        },
        {
          key: "ward",
          values: normalizeQueryArray((addressFilterSource as any).wards),
        },
      ];

      for (const { key, values } of addressFilters) {
        if (values.length === 0) continue;

        qb.andWhere(
          new Brackets((addressQb) => {
            addressColumns.forEach((column, index) => {
              const addressExpression = `"${qb.alias}"."${column!.databaseName}"`;
              const condition = `COALESCE(${addressExpression} ->> '${key}', '') IN (:...${key}Filter)`;

              if (index === 0) addressQb.where(condition);
              else addressQb.orWhere(condition);
            });
          }),
        );
        qb.setParameter(`${key}Filter`, values);
      }
    }

    // ===== Filters =====
    // nếu trong options có storeId thì và entity có storeId thì filter theo storeId
    if (options.storeId) {
      const hasStoreIdColumn = entityMetadata.columns.some(
        (col) => col.propertyName === "storeId",
      );
      if (hasStoreIdColumn) {
        qb.andWhere("(entity.storeId = :storeId OR entity.storeId IS NULL)", {
          storeId: options.storeId,
        });
      }
    }

    const storeIds = (options.moreQuery || options).storeIds;
    if (this.checkArrayFilter(storeIds)) {
      const hasStoreIdColumn = entityMetadata.columns.some(
        (col) => col.propertyName === "storeId",
      );
      if (hasStoreIdColumn) {
        qb.andWhere(
          "(entity.storeId IN (:...storeIds) OR entity.storeId IS NULL)",
          { storeIds },
        );
      }
    }

    const accessibleStoreIds = (options.moreQuery || options)
      .accessibleStoreIds;
    if (Array.isArray(accessibleStoreIds)) {
      const hasStoreIdColumn = entityMetadata.columns.some(
        (col) => col.propertyName === "storeId",
      );
      if (hasStoreIdColumn) {
        if (accessibleStoreIds.length === 0) qb.andWhere("1 = 0");
        else {
          qb.andWhere(
            "(entity.storeId IN (:...accessibleStoreIds) OR entity.storeId IS NULL)",
            { accessibleStoreIds },
          );
        }
      }
    }

    // nếu có ids thì filter theo ids
    if (this.checkArrayFilter(options.ids)) {
      qb.andWhere("entity.id IN (:...ids)", { ids: options.ids });
    }

    if (this.checkArrayFilter(options.creatorIds)) {
      qb.andWhere("entity.creatorId IN (:...creatorIds)", {
        creatorIds: options.creatorIds,
      });
    }

    if (this.checkArrayFilter(options.updaterIds)) {
      qb.andWhere("entity.updaterId IN (:...updaterIds)", {
        updaterIds: options.updaterIds,
      });
    }

    // ===== Range Filters (Gte, Gt, Eq, Lte, Lt) =====
    // Xử lý các trường range filter từ moreQuery hoặc options
    const rangeFilterSource = options.moreQuery || options;

    if (rangeFilterSource && typeof rangeFilterSource === "object") {
      const entityColumns = entityMetadata.columns.map(
        (col) => col.propertyName,
      );

      Object.keys(rangeFilterSource).forEach((key) => {
        // Kiểm tra nếu key có suffix là Gte, Gt, Eq, Lte, Lt
        const matchedSuffix = rangeSuffixes.find((suffix) =>
          key.endsWith(suffix),
        );

        if (matchedSuffix) {
          // Cắt suffix để lấy tên field
          const fieldName = key.slice(0, -matchedSuffix.length);

          // Kiểm tra field có tồn tại trong entity không
          const column = entityMetadata.findColumnWithPropertyName(fieldName);
          if (entityColumns.includes(fieldName) && column) {
            const value = rangeFilterSource[key];

            if (value != null && value !== "") {
              const columnType =
                typeof column.type === "string"
                  ? column.type.toLowerCase()
                  : "";
              const isDateColumn =
                column.type === Date ||
                columnType === "date" ||
                columnType.includes("timestamp");

              // Date ranges chỉ có ý nghĩa với Gte/Lte.
              if (isDateColumn && !["Gte", "Lte"].includes(matchedSuffix)) {
                return;
              }

              let normalizedValue = value;
              if (isDateColumn && !(value instanceof Date)) {
                const parsedDate = new Date(value);
                if (Number.isNaN(parsedDate.getTime())) return;
                if (
                  matchedSuffix === "Lte" &&
                  typeof value === "string" &&
                  /^\d{4}-\d{2}-\d{2}$/.test(value)
                ) {
                  parsedDate.setUTCHours(23, 59, 59, 999);
                }
                normalizedValue = parsedDate;
              }

              const operator = OPERATOR_MAP[matchedSuffix];
              const paramName = `${fieldName}_${matchedSuffix}`;

              qb.andWhere(`entity.${fieldName} ${operator} :${paramName}`, {
                [paramName]: normalizedValue,
              });
            }
          }
        }
      });
    }

    if (includeDeleted) {
      qb.andWhere("entity.deletedAt IS NOT NULL");
    } else {
      qb.andWhere("entity.deletedAt IS NULL");
    }

    if (options.status !== undefined) {
      qb.andWhere("entity.status = :status", { status: options.status });
    }

    if (options.type !== undefined) {
      // Only apply `type` filter when the entity actually has a `type` column
      const hasTypeColumn = repository.metadata.columns.some(
        (col) => col.propertyName === "type",
      );
      if (hasTypeColumn) {
        qb.andWhere("entity.type = :type", { type: options.type });
      }
    }

    if (options.isFinished !== undefined) {
      const hasIsFinishedColumn = repository.metadata.columns.some(
        (col) => col.propertyName === "isFinished",
      );

      if (hasIsFinishedColumn) {
        qb.andWhere("entity.isFinished = :isFinished", {
          isFinished: options.isFinished,
        });
      }
    }

    if (options.isActive !== undefined) {
      const hasIsActiveColumn = repository.metadata.columns.some(
        (col) => col.propertyName === "isActive",
      );

      if (hasIsActiveColumn) {
        qb.andWhere("entity.isActive = :isActive", {
          isActive: options.isActive,
        });
      }
    }

    // BETWEEN createdAt
    if (options.startAt && options.endAt && options.timeField) {
      const dateField = String(options.timeField);
      const end = new Date(options.endAt);
      const rawEndAt = (options.moreQuery || options).endAt;
      if (
        typeof rawEndAt === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(rawEndAt)
      ) {
        end.setUTCHours(23, 59, 59, 999);
      }
      qb.andWhere(`entity.${dateField} BETWEEN :start AND :end`, {
        start: new Date(options.startAt),
        end,
      });
    }

    // ===== Sorting =====
    if (options.sortBy && options.sortOrder) {
      let sortField: string | null = null;

      // Nếu sortBy có dấu chấm (relation field), kiểm tra xem relation đã được join chưa
      if (options.sortBy.includes(".")) {
        const [relationName] = options.sortBy.split(".");
        const isJoined = (qb as any).expressionMap.joinAttributes.some(
          (j: any) => j.relation?.propertyName === relationName,
        );
        if (isJoined) {
          sortField = options.sortBy;
        }
      } else {
        // Chỉ cho phép sort theo column của entity
        const entityColumns = repository.metadata.columns.map(
          (col) => col.propertyName,
        );
        if (entityColumns.includes(options.sortBy)) {
          sortField = `entity.${options.sortBy}`;
        }
        // Nếu không phải column thì bỏ qua, để repo con tự custom
      }

      // Nếu sortField hợp lệ thì apply orderBy
      if (sortField) {
        qb.orderBy(sortField, options.sortOrder);
      }
      // Nếu sortBy không hợp lệ thì KHÔNG áp dụng sorting (để repo con tự xử lý)
    } else {
      // Chỉ khi không truyền sortBy thì mới fallback về createdAt
      qb.orderBy("entity.createdAt", "DESC");
    }

    // Tạo clone query cho summary (không có pagination)
    let summary: any = {};
    if (options.summaryFields && options.summaryFields.length > 0) {
      const filteredQb = qb.clone();

      // Xóa skip/take/orderBy khỏi query lọc dùng cho summary
      filteredQb.skip(0).take(undefined as any);
      (filteredQb as any).expressionMap.orderBys = [];

      // Lưu lại computed selects (alias prefix entity_) để hỗ trợ summary field là computed
      const computedSelects =
        (filteredQb as any).expressionMap?.selects?.filter((s: any) =>
          s.aliasName?.startsWith("entity_"),
        ) || [];

      // Lấy tập id entity đã được filter (distinct) để tránh double-count do join 1-n
      const filteredIdsQb = filteredQb.clone();
      (filteredIdsQb as any).expressionMap.selects = [];
      filteredIdsQb.select("entity.id", "id").distinct(true);

      // Summary query chạy trên bảng gốc + điều kiện id IN (filtered ids)
      const summaryQb = repository
        .createQueryBuilder("entity")
        .where(`entity.id IN (${filteredIdsQb.getQuery()})`)
        .setParameters(filteredIdsQb.getParameters());

      // Build sum selects
      const sumSelects: string[] = [];

      options.summaryFields.forEach((field) => {
        const fieldStr = String(field);

        // Kiểm tra xem field có phải là computed field không
        // Thử tìm cả camelCase và lowercase
        let computedSelect = computedSelects.find(
          (s: any) => s.aliasName === `entity_${fieldStr}`,
        );

        // Nếu không tìm thấy, thử lowercase
        if (!computedSelect) {
          computedSelect = computedSelects.find(
            (s: any) => s.aliasName === `entity_${fieldStr.toLowerCase()}`,
          );
        }

        if (computedSelect) {
          // Nếu là computed field, wrap subquery trong SUM
          // Lấy expression gốc từ computed select
          const subqueryExpression = computedSelect.selection;
          sumSelects.push(
            `COALESCE(SUM((${subqueryExpression})), 0) as ${fieldStr}_sum`,
          );
        } else {
          // Nếu là column thông thường
          sumSelects.push(
            `COALESCE(SUM(entity.${fieldStr}), 0) as ${fieldStr}_sum`,
          );
        }
      });

      // Clear selects và set lại với sum
      (summaryQb as any).expressionMap.selects = [];
      summaryQb.select(sumSelects);

      const summaryResult = await summaryQb.getRawOne();

      // Map kết quả summary - xử lý lowercase keys
      options.summaryFields.forEach((field) => {
        const fieldStr = String(field);
        // PostgreSQL trả về lowercase key
        const summaryKey = `${fieldStr.toLowerCase()}_sum`;
        const value = summaryResult[summaryKey];

        // Nếu field đã có prefix "total" thì giữ nguyên, không thêm "total" nữa
        const summaryFieldName = fieldStr.toLowerCase().startsWith("total")
          ? fieldStr
          : `total${fieldStr.charAt(0).toUpperCase() + fieldStr.slice(1)}`;

        summary[summaryFieldName] = parseFloat(value) || 0;
      });
    }

    qb.skip((page - 1) * size).take(size);

    // ===== Execute =====
    const hasGroupBy = (qb as any).expressionMap?.groupBys?.length > 0;
    const hasExtraSelect = (qb as any).expressionMap?.selects?.some((s: any) =>
      s.aliasName?.startsWith("entity_"),
    );

    if (hasGroupBy || hasExtraSelect) {
      const [rawAndEntities, total] = await Promise.all([
        qb.getRawAndEntities(),
        qb.getCount(),
      ]);
      let data = this.mapRawEntities(rawAndEntities);
      if (this.enableFileAttachment && Array.isArray(data)) {
        data = await this.attachFilesToEntities(data);
      }
      return {
        data,
        total,
        summary: Object.keys(summary).length > 0 ? summary : undefined,
      };
    } else {
      const [data, total] = await qb.getManyAndCount();
      let finalData = data;
      if (this.enableFileAttachment && Array.isArray(data)) {
        finalData = await this.attachFilesToEntities(data);
      }

      return {
        data: finalData,
        total,
        summary: Object.keys(summary).length > 0 ? summary : undefined,
      };
    }
  }

  async findByOptions(
    options: FindManyOptions<T>,
    manager?: EntityManager,
  ): Promise<T[]> {
    const data = await this.getRepository(manager).find({
      ...options,
      select:
        options?.select || this.selectedFieldsForList || this.selectedFields,
      relations: options?.relations || this.relationsForList || this.relations,
    });
    if (this.enableFileAttachment && Array.isArray(data))
      return await this.attachFilesToEntities(data);
    return data;
  }

  async findByOption(
    options: FindOneOptions<T>,
    manager?: EntityManager,
    includeDeleted: boolean = false,
  ): Promise<T | null> {
    if (!includeDeleted) {
      options.where = { ...options.where, deletedAt: IsNull() } as any;
    }

    const data = await this.getRepository(manager).findOne({
      ...options,
      select: options?.select || this.selectedFields,
      relations: options?.relations || this.relations,
    });
    if (data && this.enableFileAttachment) await this.attachFilesToEntity(data);
    return data;
  }

  async findAndCount(
    options: FindManyOptions<T>,
    manager?: EntityManager,
    includeDeleted: boolean = false,
  ): Promise<[T[], number]> {
    if (!includeDeleted) {
      options.where = { ...options.where, deletedAt: IsNull() } as any;
    } else {
      options.withDeleted = true;
    }
    return await this.getRepository(manager).findAndCount(options);
  }

  async create(
    data: DeepPartial<T>,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<T> {
    const storeId = req?.storeContext?.storeId;

    const repo = this.getRepository(manager);
    const entityInfo = repo.metadata;

    const hasSortOrderColumn = entityInfo?.columns?.some(
      (column) => column.propertyName === "sortOrder",
    );

    const hasStoreIdColumn = entityInfo?.columns?.some(
      (column) => column.propertyName === "storeId",
    );

    if (!(data as any).sortOrder && hasSortOrderColumn) {
      const whereCondition = this.sortOrderScope
        ? ({
            [this.sortOrderScope]: (data as any)[this.sortOrderScope],
          } as FindOptionsWhere<T>)
        : hasStoreIdColumn
          ? ({
              storeId: (data as any).storeId,
            } as FindOptionsWhere<T>)
          : undefined;
      (data as any).sortOrder = await this.getNextSortOrder(
        whereCondition,
        manager,
      );
    }

    if (hasStoreIdColumn) {
      const allowsGlobalStoreScope = (this.entityClass as any).name === "Fund";
      if (req && !storeId && !allowsGlobalStoreScope)
        throw new BadRequestError("Vui lòng chọn cửa hàng đang thao tác");
      if ((data as any).storeId === undefined) {
        (data as any).storeId = storeId || null;
      }
      if (
        req &&
        (data as any).storeId !== storeId &&
        !(allowsGlobalStoreScope && (data as any).storeId == null)
      ) {
        throw new BadRequestError("Dữ liệu phải thuộc cửa hàng đang thao tác");
      }
    }

    const hasCodeColumn = entityInfo?.columns?.some(
      (column) => column.propertyName === "code",
    );
    if (hasCodeColumn && !(data as any).code) {
      const code = await generateCode((data as any).type ?? entityInfo.name);
      (data as any).code = code;
    }
    const entity = repo.create(data);
    const saved = await repo.save(entity);

    // Handle files after creation: move files from tempId to realId
    const tempId = (saved as any).tempId;
    const id = (saved as any).id;
    if (tempId && id) {
      await this.handleFilesOnCreate(id, tempId, saved);
    }

    return saved;
  }

  /**
   * Create many
   */
  async createMany(
    data: DeepPartial<T>[],
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<T[]> {
    // Nạp thêm sortOrder và code nếu có
    const repo = this.getRepository(manager);
    const entityInfo = repo.metadata;

    const hasSortOrderColumn = entityInfo?.columns?.some(
      (column) => column.propertyName === "sortOrder",
    );
    const hasCodeColumn = entityInfo?.columns?.some(
      (column) => column.propertyName === "code",
    );
    const hasStoreIdColumn = entityInfo?.columns?.some(
      (column) => column.propertyName === "storeId",
    );

    if (hasSortOrderColumn) {
      const whereCondition = this.sortOrderScope
        ? ({
            [this.sortOrderScope]: (data as any)[this.sortOrderScope],
          } as FindOptionsWhere<T>)
        : hasStoreIdColumn
          ? ({
              storeId: (data as any)[0]?.storeId,
            } as FindOptionsWhere<T>)
          : undefined;
      const newNextSortOrder = await this.getNextSortOrder(
        whereCondition,
        manager,
      );

      data.forEach((item, index) => {
        if (!(item as any).sortOrder) {
          (item as any).sortOrder = newNextSortOrder + index * 10;
        }
      });
    }

    if (hasCodeColumn) {
      for (const item of data) {
        if (!(item as any).code) {
          const storeId = (item as any).storeId;
          (item as any).code = await generateCode(entityInfo?.name, storeId);
        }
      }
    }

    if (hasStoreIdColumn) {
      const storeId = req?.storeContext?.storeId;
      const allowsGlobalStoreScope = (this.entityClass as any).name === "Fund";
      if (req && !storeId && !allowsGlobalStoreScope)
        throw new BadRequestError("Vui lòng chọn cửa hàng đang thao tác");
      data.forEach((item) => {
        if ((item as any).storeId === undefined) {
          (item as any).storeId = storeId || null;
        }
        if (
          req &&
          (item as any).storeId !== storeId &&
          !(allowsGlobalStoreScope && (item as any).storeId == null)
        ) {
          throw new BadRequestError(
            "Dữ liệu phải thuộc cửa hàng đang thao tác",
          );
        }
      });
    }

    const entities = repo.create(data as any[]);
    const saved = await repo.save(entities as any);
    return saved as T[];
  }

  /**
   * Update
   */
  async update(
    id: string,
    data: DeepPartial<T>,
    manager?: EntityManager,
  ): Promise<T | null> {
    const repo = this.getRepository(manager);
    await repo.update(id, data as any);

    // Get updated entity để xử lý nested files
    const updatedEntity = await repo.findOne({
      where: { id } as any,
      relations: this.relations,
    });

    // Handle files after update: activate all files
    await this.handleFilesOnUpdate(id, manager, updatedEntity);

    if (manager) {
      if (updatedEntity && this.enableFileAttachment) {
        await this.attachFilesToEntity(updatedEntity as any);
      }
      return updatedEntity || null;
    }

    return this.findById(id);
  }

  /**
   * Delete (hard delete)
   */
  async delete(id: string, manager?: EntityManager): Promise<boolean> {
    // Handle files before deletion
    await this.handleFilesOnDelete(id, manager);

    const result = await this.getRepository(manager).delete(id as any);
    return (result.affected ?? 0) > 0;
  }

  async deleteMany(ids: string[], manager?: EntityManager): Promise<number> {
    // Handle files before deletion
    for (const id of ids) {
      await this.handleFilesOnDelete(id, manager);
    }
    const result = await this.getRepository(manager).delete(ids as any);
    return result.affected ?? 0;
  }

  async deleteByCondition(
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    manager?: EntityManager,
  ): Promise<number> {
    const repo = this.getRepository(manager);

    const result = await repo.delete(where as any);

    return result.affected ?? 0;
  }
  /**
   * Soft delete
   */
  async softDelete(id: string, manager?: EntityManager): Promise<boolean> {
    // Handle files before soft deletion
    await this.handleFilesOnDelete(id, manager);

    const result = await this.getRepository(manager).softDelete(id as any);
    return (result.affected ?? 0) > 0;
  }

  /**
   * Soft delete many
   */
  async softDeleteMany(
    options: FindOptionsWhere<T>,
    manager?: EntityManager,
  ): Promise<number> {
    const result = await this.getRepository(manager).softDelete(options);
    return result.affected ?? 0;
  }

  /**
   * Count
   */
  async count(
    options?: FindManyOptions<T>,
    manager?: EntityManager,
  ): Promise<number> {
    return this.getRepository(manager).count(options);
  }

  /**
   * Check exists
   */
  async exists(
    where: FindOptionsWhere<T>,
    manager?: EntityManager,
  ): Promise<boolean> {
    const count = await this.getRepository(manager).count({ where });
    return count > 0;
  }

  /**
   * Query builder
   */
  async createQueryBuilder(
    alias: string,
    manager?: EntityManager,
  ): Promise<SelectQueryBuilder<T>> {
    return this.getRepository(manager).createQueryBuilder(alias);
  }

  /**
   * Attach files to a single entity
   * Tự động gọi khi query entity
   * Hỗ trợ nested entities thông qua nestedFileFields
   */
  private async attachFilesToEntity(entity: T & { id?: string }): Promise<T> {
    if (!entity || !entity.id) {
      return entity;
    }

    try {
      // Get File repository from store schema
      const fileRepo = this.getFileRepository();

      // Collect all entity IDs (root + nested)
      const collectedIds: string[] = [entity.id];

      // Helper function to get value from path (e.g., "lines.productId")
      const getValueByPath = (obj: any, path: string): any[] => {
        const parts = path.split(".");
        let current: any = obj;

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];

          if (!current) {
            return [];
          }

          // If current is an array, map over each item to get the property
          if (Array.isArray(current)) {
            const mapped = current
              .map((item) => item?.[part])
              .filter((val) => val !== null && val !== undefined);
            current = mapped;
          } else {
            // Normal object property access
            current = current[part];

            if (!current) {
              return [];
            }
          }
        }

        // Flatten if result is nested array
        if (Array.isArray(current)) {
          return current.flat();
        }
        if (current && typeof current === "object") {
          return [current];
        }
        return [];
      };

      const finalNestedFileFields = [
        ...(this.nestedFileFields || []),
        "creatorSnapshot",
        "updaterSnapshot",
      ];

      // Collect nested entity IDs based on nestedFileFields
      if (finalNestedFileFields && finalNestedFileFields.length > 0) {
        for (const fieldPath of finalNestedFileFields) {
          const values = getValueByPath(entity, fieldPath);

          for (const item of values) {
            if (item && typeof item === "object" && item.id) {
              collectedIds.push(item.id);
            }
          }
        }
      }

      // Get files for all collected IDs
      const files = await fileRepo.find({
        where: {
          entityId: In(collectedIds),
          status: FileStatus.ACTIVE,
          deletedAt: null,
        } as any,
        order: { createdAt: "ASC" } as any,
      });

      // Group files by entityId and category
      const filesByEntity: Record<string, Record<string, any[]>> = {};

      for (const file of files) {
        const entityId = (file as any).entityId;
        if (!entityId) continue;

        if (!filesByEntity[entityId]) {
          filesByEntity[entityId] = {};
        }

        const category = (file as any).category || "uncategorized";
        if (!filesByEntity[entityId][category]) {
          filesByEntity[entityId][category] = [];
        }

        filesByEntity[entityId][category].push(file);
      }

      // Attach files to root entity
      const entAny: any = { ...entity };
      if (entity.id && filesByEntity[entity.id]) {
        Object.assign(entAny, filesByEntity[entity.id]);
      }

      // Attach files to nested entities based on paths
      if (this.nestedFileFields && this.nestedFileFields.length > 0) {
        for (const fieldPath of this.nestedFileFields) {
          const parts = fieldPath.split(".");
          let current: any = entAny;

          // Navigate to parent of target field
          for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]]) break;
            current = current[parts[i]];
          }

          const lastPart = parts[parts.length - 1];

          // Attach files to array items
          if (Array.isArray(current)) {
            for (let i = 0; i < current.length; i++) {
              const item = current[i];
              if (!item) continue;

              const target = parts.length === 1 ? item : item[lastPart];

              if (Array.isArray(target)) {
                // Target is array
                item[lastPart] = target.map((subItem: any) => {
                  if (!subItem || !subItem.id) return subItem;
                  const childFiles = filesByEntity[subItem.id] || {};
                  return { ...subItem, ...childFiles };
                });
              } else if (target && typeof target === "object" && target.id) {
                // Target is single object
                const childFiles = filesByEntity[target.id] || {};
                item[lastPart] = { ...target, ...childFiles };
              } else if (parts.length === 1 && item.id) {
                // Direct array item
                const childFiles = filesByEntity[item.id] || {};
                current[i] = { ...item, ...childFiles };
              }
            }
          } else if (current[lastPart]) {
            // Handle nested field (array or single object)
            const target = current[lastPart];

            if (Array.isArray(target)) {
              // Target is array - attach files to each item
              current[lastPart] = target.map((item: any) => {
                if (!item || !item.id) return item;
                const childFiles = filesByEntity[item.id] || {};
                return { ...item, ...childFiles };
              });
            } else if (target && typeof target === "object" && target.id) {
              // Target is single object
              const childFiles = filesByEntity[target.id] || {};
              current[lastPart] = { ...target, ...childFiles };
            }
          }
        }
      }

      // Generate presigned URLs for S3 files
      await this.resolvePresignedUrls(entAny);

      return entAny as T;
    } catch (error) {
      // Silent fail - không ảnh hưởng query chính
      logger.warn(`Failed to attach files to entity ${entity.id}:`, error);
      return entity;
    }
  }

  /**
   * Attach files to multiple entities
   * Tự động gọi khi query danh sách entities
   */
  private async attachFilesToEntities(
    entities: (T & { id?: string })[],
  ): Promise<T[]> {
    if (!entities || entities.length === 0) {
      return entities;
    }

    try {
      const collectedIds: string[] = [];

      // Helper function to get value from path
      const getValueByPath = (obj: any, path: string): any[] => {
        const parts = path.split(".");
        let current: any = obj;

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];

          if (!current) {
            return [];
          }

          // If current is an array, map over each item to get the property
          if (Array.isArray(current)) {
            const mapped = current
              .map((item) => item?.[part])
              .filter((val) => val !== null && val !== undefined);
            current = mapped;
          } else {
            // Normal object property access
            current = current[part];

            if (!current) {
              return [];
            }
          }
        }

        // Flatten if result is nested array
        if (Array.isArray(current)) {
          return current.flat();
        }
        if (current && typeof current === "object") {
          return [current];
        }
        return [];
      };

      // Collect all entity IDs
      for (const e of entities) {
        if (e.id) collectedIds.push(e.id as string);

        // Collect nested IDs based on nestedFileFields
        if (this.nestedFileFields && this.nestedFileFields.length > 0) {
          for (const fieldPath of this.nestedFileFields) {
            const values = getValueByPath(e, fieldPath);

            for (const item of values) {
              if (item && typeof item === "object" && item.id) {
                collectedIds.push(item.id);
              }
            }
          }
        }
      }

      const uniqueIds = Array.from(new Set(collectedIds));
      if (uniqueIds.length === 0) return entities;

      // Get File repository from store schema
      const fileRepo = this.getFileRepository();
      const allFiles = await fileRepo.find({
        where: {
          entityId: In(uniqueIds),
          status: FileStatus.ACTIVE,
          deletedAt: null,
        } as any,
        order: { createdAt: "ASC" } as any,
      });

      if (allFiles.length > 0) {
        allFiles.slice(0, 5).forEach((f: any) => {});
        if (allFiles.length > 5) {
        }
      }

      // Group files by entityId and category
      const filesByEntity: Record<string, Record<string, any[]>> = {};

      for (const file of allFiles) {
        const entityId = (file as any).entityId;
        if (!entityId) continue;

        if (!filesByEntity[entityId]) {
          filesByEntity[entityId] = {};
        }

        const category = (file as any).category || "uncategorized";
        if (!filesByEntity[entityId][category]) {
          filesByEntity[entityId][category] = [];
        }

        filesByEntity[entityId][category].push(file);
      }

      // Attach files to root entities and nested entities
      const result = entities.map((entity) => {
        if (!entity.id) return entity;

        const entAny: any = { ...entity };

        // Attach files to root entity
        if (entity.id && filesByEntity[entity.id]) {
          Object.assign(entAny, filesByEntity[entity.id]);
        }

        // Attach files to nested entities based on paths
        if (this.nestedFileFields && this.nestedFileFields.length > 0) {
          for (const fieldPath of this.nestedFileFields) {
            const parts = fieldPath.split(".");
            let current: any = entAny;

            // Navigate to parent of target field
            for (let i = 0; i < parts.length - 1; i++) {
              if (!current[parts[i]]) break;
              current = current[parts[i]];
            }

            const lastPart = parts[parts.length - 1];

            // Attach files to array items
            if (Array.isArray(current)) {
              for (let i = 0; i < current.length; i++) {
                const item = current[i];
                if (!item) continue;

                const target = parts.length === 1 ? item : item[lastPart];

                if (Array.isArray(target)) {
                  // Target is array
                  item[lastPart] = target.map((subItem: any) => {
                    if (!subItem || !subItem.id) return subItem;
                    const childFiles = filesByEntity[subItem.id] || {};
                    return { ...subItem, ...childFiles };
                  });
                } else if (target && typeof target === "object" && target.id) {
                  // Target is single object
                  const childFiles = filesByEntity[target.id] || {};
                  item[lastPart] = { ...target, ...childFiles };
                } else if (parts.length === 1 && item.id) {
                  // Direct array item
                  const childFiles = filesByEntity[item.id] || {};
                  current[i] = { ...item, ...childFiles };
                }
              }
            } else if (current[lastPart]) {
              // Handle nested field (array or single object)
              const target = current[lastPart];

              if (Array.isArray(target)) {
                // Target is array - attach files to each item
                current[lastPart] = target.map((item: any) => {
                  if (!item || !item.id) return item;
                  const childFiles = filesByEntity[item.id] || {};
                  return { ...item, ...childFiles };
                });
              } else if (target && typeof target === "object" && target.id) {
                // Target is single object
                const childFiles = filesByEntity[target.id] || {};
                current[lastPart] = { ...target, ...childFiles };
              }
            }
          }
        }

        return entAny as T;
      });

      // Generate presigned URLs for S3 files (all entities)
      for (const e of result) {
        await this.resolvePresignedUrls(e as any);
      }

      return result;
    } catch (error) {
      // Silent fail - không ảnh hưởng query chính
      logger.warn(
        `Failed to attach files to ${entities.length} entities:`,
        error,
      );
      return entities;
    }
  }

  /**
   * Handle files after entity creation
   * Chuyển files từ tempId sang realId và active
   * Tự động xử lý nested entities thông qua nestedFileFields
   */
  protected async handleFilesOnCreate(
    entityId: string,
    tempId?: string,
    savedEntity?: any,
  ): Promise<void> {
    if (!tempId) return;

    try {
      const fileRepo = this.getFileRepository();

      // Update files from tempId to realId and set status to ACTIVE
      const result = await fileRepo.update(
        {
          entityId: tempId,
        },
        {
          entityId: entityId,
          status: FileStatus.ACTIVE,
          expiresAt: null,
        },
      );
      logger.info(
        `Updated ${result.affected} files from tempId ${tempId} to entityId ${entityId}`,
      );
      logger.info(
        `Updated files from tempId ${tempId} to entityId ${entityId}`,
      );

      // Xử lý files cho nested entities (ví dụ: variants trong product)
      if (
        savedEntity &&
        this.nestedFileFields &&
        this.nestedFileFields.length > 0
      ) {
        for (const fieldKey of this.nestedFileFields) {
          const nestedData = savedEntity[fieldKey];

          // Kiểm tra nếu là array
          if (Array.isArray(nestedData) && nestedData.length > 0) {
            for (const nestedItem of nestedData) {
              if (nestedItem && nestedItem.tempId && nestedItem.id) {
                await fileRepo.update(
                  { entityId: tempId },
                  {
                    entityId,
                    status: FileStatus.ACTIVE,
                    expiresAt: null,
                  },
                );
                logger.info(
                  `Updated files for nested ${fieldKey}: ${nestedItem.tempId} -> ${nestedItem.id}`,
                );
              }
            }
          }
          // Kiểm tra nếu là object đơn
          else if (
            nestedData &&
            typeof nestedData === "object" &&
            nestedData.tempId &&
            nestedData.id
          ) {
            await fileRepo.update(
              { entityId: tempId },
              {
                entityId,
                status: FileStatus.ACTIVE,
                expiresAt: null,
              },
            );
            logger.info(
              `Updated files for nested ${fieldKey}: ${nestedData.tempId} -> ${nestedData.id}`,
            );
          }
        }
      }
    } catch (error) {
      logger.error(
        `Failed to handle files on create for entity ${entityId}:`,
        error,
      );
    }
  }

  /**
   * Handle files after entity update
   * Activate all files linked to entity
   * Tự động xử lý nested entities thông qua nestedFileFields
   */
  protected async handleFilesOnUpdate(
    entityId: string,
    manager?: EntityManager,
    updatedEntity?: any,
  ): Promise<void> {
    try {
      const fileRepo = this.getFileRepository(manager);

      // Nếu multipleFile = false, xóa files cũ trước khi activate files mới
      if (!this.multipleFile) {
        // Get all pending files for this entity (files mới upload)
        const pendingFiles = await fileRepo.find({
          where: {
            entityId: entityId,
            status: FileStatus.PENDING,
            deletedAt: null,
          } as any,
          order: { createdAt: "DESC" } as any,
        });

        // Group pending files by category
        const pendingByCategory: Record<string, any[]> = {};
        for (const file of pendingFiles) {
          const category = (file as any).category || "default";
          if (!pendingByCategory[category]) {
            pendingByCategory[category] = [];
          }
          pendingByCategory[category].push(file);
        }

        // For each category, delete old active files
        for (const [category, files] of Object.entries(pendingByCategory)) {
          if (files.length > 0) {
            // Soft delete old active files in this category
            await fileRepo
              .createQueryBuilder()
              .softDelete()
              .where("entityId = :entityId", { entityId })
              .andWhere("category = :category", { category })
              .andWhere("status = :status", { status: FileStatus.ACTIVE })
              .andWhere("deletedAt IS NULL")
              .execute();

            logger.info(`Deleted old active files for category "${category}"`);
          }
        }
      } else if (
        this.singleFileCategories &&
        this.singleFileCategories.length > 0
      ) {
        // multipleFile = true but some categories are single-file
        // Only delete old active files for categories in singleFileCategories
        const pendingFiles = await fileRepo.find({
          where: {
            entityId: entityId,
            status: FileStatus.PENDING,
            deletedAt: null,
          } as any,
          order: { createdAt: "DESC" } as any,
        });

        const pendingCategories = new Set(
          pendingFiles.map((f: any) => f.category || "default"),
        );

        for (const category of this.singleFileCategories) {
          if (pendingCategories.has(category)) {
            await fileRepo
              .createQueryBuilder()
              .softDelete()
              .where("entityId = :entityId", { entityId })
              .andWhere("category = :category", { category })
              .andWhere("status = :status", { status: FileStatus.ACTIVE })
              .andWhere("deletedAt IS NULL")
              .execute();

            logger.info(
              `Deleted old active files for single-file category "${category}"`,
            );
          }
        }
      }

      // Activate all pending files
      // const updateResult =
      await fileRepo
        .createQueryBuilder()
        .update()
        .set({
          status: FileStatus.ACTIVE,
          expiresAt: null,
        })
        .where("entityId = :entityId", { entityId })
        .andWhere("status = :status", { status: FileStatus.PENDING })
        .andWhere("deletedAt IS NULL")
        .execute();

      // logger.info(
      //   `Activated ${updateResult.affected} files for entity ${entityId}`,
      // );

      // Xử lý files cho nested entities (ví dụ: variants trong product)
      if (
        updatedEntity &&
        this.nestedFileFields &&
        this.nestedFileFields.length > 0
      ) {
        for (const fieldKey of this.nestedFileFields) {
          const nestedData = updatedEntity[fieldKey];

          // Kiểm tra nếu là array
          if (Array.isArray(nestedData) && nestedData.length > 0) {
            for (const nestedItem of nestedData) {
              if (nestedItem && nestedItem.id) {
                // ⚠️ Nested entities LUÔN chỉ giữ 1 file/category (single file mode)
                const pendingFiles = await fileRepo.find({
                  where: {
                    entityId: nestedItem.id,
                    status: FileStatus.PENDING,
                    deletedAt: null,
                  } as any,
                });

                const pendingByCategory: Record<string, any[]> = {};
                for (const file of pendingFiles) {
                  const category = (file as any).category || "default";
                  if (!pendingByCategory[category]) {
                    pendingByCategory[category] = [];
                  }
                  pendingByCategory[category].push(file);
                }

                // Xóa files cũ trước khi activate files mới
                for (const [category] of Object.entries(pendingByCategory)) {
                  await fileRepo
                    .createQueryBuilder()
                    .softDelete()
                    .where("entityId = :entityId", {
                      entityId: nestedItem.id,
                    })
                    .andWhere("category = :category", { category })
                    .andWhere("status = :status", {
                      status: FileStatus.ACTIVE,
                    })
                    .andWhere("deletedAt IS NULL")
                    .execute();
                }

                // Activate pending files
                await fileRepo
                  .createQueryBuilder()
                  .update()
                  .set({
                    status: FileStatus.ACTIVE,
                    expiresAt: null,
                  })
                  .where("entityId = :entityId", { entityId: nestedItem.id })
                  .andWhere("status = :status", {
                    status: FileStatus.PENDING,
                  })
                  .andWhere("deletedAt IS NULL")
                  .execute();
              }
            }
          }
          // Kiểm tra nếu là object đơn
          else if (
            nestedData &&
            typeof nestedData === "object" &&
            nestedData.id
          ) {
            // ⚠️ Nested entities LUÔN chỉ giữ 1 file/category (single file mode)
            const pendingFiles = await fileRepo.find({
              where: {
                entityId: nestedData.id,
                status: FileStatus.PENDING,
                deletedAt: null,
              } as any,
            });

            const pendingByCategory: Record<string, any[]> = {};
            for (const file of pendingFiles) {
              const category = (file as any).category || "default";
              if (!pendingByCategory[category]) {
                pendingByCategory[category] = [];
              }
              pendingByCategory[category].push(file);
            }

            // Xóa files cũ trước khi activate files mới
            for (const [category] of Object.entries(pendingByCategory)) {
              await fileRepo
                .createQueryBuilder()
                .softDelete()
                .where("entityId = :entityId", { entityId: nestedData.id })
                .andWhere("category = :category", { category })
                .andWhere("status = :status", {
                  status: FileStatus.ACTIVE,
                })
                .andWhere("deletedAt IS NULL")
                .execute();
            }

            // Activate pending files
            await fileRepo
              .createQueryBuilder()
              .update()
              .set({
                status: FileStatus.ACTIVE,
                expiresAt: null,
              })
              .where("entityId = :entityId", { entityId: nestedData.id })
              .andWhere("status = :status", { status: FileStatus.PENDING })
              .andWhere("deletedAt IS NULL")
              .execute();
          }
        }
      }
    } catch (error) {
      logger.error(
        `Failed to handle files on update for entity ${entityId}:`,
        error,
      );
    }
  }

  /**
   * Handle files after entity deletion
   * Delete all files linked to entity (DB + physical storage)
   * Tự động xử lý nested entities thông qua nestedFileFields
   */
  protected async handleFilesOnDelete(
    entityId: string,
    manager?: EntityManager,
  ): Promise<void> {
    try {
      const fileRepo = this.getFileRepository(manager);

      // Get entity với relations để lấy nested entities
      const repo = this.getRepository(manager);

      const entity = await repo.findOne({
        where: { id: entityId } as any,
        relations: this.relations,
      });

      // Collect tất cả entityIds cần xóa files (entity chính + nested entities)
      const entityIdsToDelete: string[] = [entityId];

      // Thu thập IDs của nested entities
      if (entity && this.nestedFileFields && this.nestedFileFields.length > 0) {
        for (const fieldKey of this.nestedFileFields) {
          const nestedData = (entity as any)[fieldKey];

          // Kiểm tra nếu là array
          if (Array.isArray(nestedData) && nestedData.length > 0) {
            for (const nestedItem of nestedData) {
              if (nestedItem && nestedItem.id) {
                entityIdsToDelete.push(nestedItem.id);
              }
            }
          }
          // Kiểm tra nếu là object đơn
          else if (
            nestedData &&
            typeof nestedData === "object" &&
            nestedData.id
          ) {
            entityIdsToDelete.push(nestedData.id);
          }
        }
      }

      // Get all files linked to entity và nested entities
      const files = await fileRepo.find({
        where: {
          entityId: In(entityIdsToDelete),
        } as any,
      });

      // Delete physical files
      for (const file of files) {
        try {
          const filePath = (file as any).path;
          const thumbnailPath = (file as any).thumbnailPath;

          if (filePath) {
            await fs.unlink(filePath).catch(() => {
              // File might not exist, ignore error
            });
          }

          if (thumbnailPath) {
            await fs.unlink(thumbnailPath).catch(() => {
              // Thumbnail might not exist, ignore error
            });
          }
        } catch (error) {
          logger.warn(
            `Failed to delete physical file ${(file as any).path}:`,
            error,
          );
        }
      }

      // Delete files from database
      await fileRepo.delete({
        entityId: In(entityIdsToDelete),
      } as any);

      logger.info(
        `Deleted ${files.length} files for entity ${entityId} and nested entities`,
      );
    } catch (error) {
      logger.error(
        `Failed to handle files on delete for entity ${entityId}:`,
        error,
      );
    }
  }

  checkArrayFilter(value?: any): boolean {
    return value && Array.isArray(value) && value.length > 0;
  }

  async sum(
    field: keyof T,
    where?: FindOptionsWhere<T>,
    manager?: EntityManager,
  ): Promise<number> {
    const repo = this.getRepository(manager);
    const qb = repo.createQueryBuilder("entity");

    qb.select(`COALESCE(SUM(entity.${String(field)}), 0)`, "total");

    if (where) {
      qb.where(where);
    }

    const result = await qb.getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  async incrementField<K extends keyof T>(
    where: FindOptionsWhere<T>,
    field: K,
    amount: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepository(manager);

    await repo.increment(where as any, field as string, amount);
  }

  async getNextSortOrder(
    where?: FindOptionsWhere<T>,
    manager?: EntityManager,
  ): Promise<number> {
    const maxSortOrderItem = await this.findByOption(
      {
        where,
        order: { sortOrder: "DESC" } as any,
      },
      manager,
    );

    return (maxSortOrderItem?.sortOrder || 0) + 10;
  }

  /**
   * Convert S3 storageKey → presigned URL cho tất cả file đã upload lên S3.
   * Gọi sau khi attach files vào entity.
   * Xử lý cả storageKey và thumbnailStorageKey.
   */
  private async resolvePresignedUrls(entity: any): Promise<void> {
    try {
      // Duyệt tất cả properties tìm file arrays (theo category)
      const categoryKeys = Object.keys(entity).filter(
        (k) =>
          Array.isArray(entity[k]) &&
          entity[k].length > 0 &&
          entity[k][0]?.storageKey,
      );

      for (const catKey of categoryKeys) {
        const files = entity[catKey] as any[];
        for (const file of files) {
          // Resolve main file presigned URL
          if (file.isUploadedToS3 && file.storageKey) {
            const { getPresignedUrl } = await import("../utils/s3Helper.js");
            const presignedUrl = await getPresignedUrl(file.storageKey);
            if (presignedUrl) {
              file.url = presignedUrl;
            }
          }

          // Resolve thumbnail presigned URL
          if (file.isUploadedToS3 && file.thumbnailStorageKey) {
            const { getPresignedUrl: getThumbPresignedUrl } =
              await import("../utils/s3Helper.js");
            const thumbPresignedUrl = await getThumbPresignedUrl(
              file.thumbnailStorageKey,
            );
            if (thumbPresignedUrl) {
              file.thumbnailUrl = thumbPresignedUrl;
            }
          }
        }
      }
    } catch {
      // Silent fail — presigned URL is optional
    }
  }

  private getFileRepository(manager?: EntityManager) {
    return manager
      ? manager.getRepository("File")
      : this.dataSource.getRepository("File");
  }
}
