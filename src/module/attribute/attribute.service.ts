import { injectable, inject } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import {
  ActionMap,
  ActionValue,
  RequestContext,
} from "@/shared/types/interfaces";
import { BadRequestError, ValidationError } from "@/shared/types/errors";
import { BaseService } from "@/shared/base/BaseService";
import {
  Attribute,
  AttributeType,
  isStoreScopedAttributeType,
} from "@/database/models/Attribute";
import { AttributeRepository } from "./attribute.repository";
import { ATTRIBUTE_TYPES } from "./attribute.types";

@injectable()
export class AttributeService extends BaseService<Attribute> {
  private static readonly MAX_PRODUCT_GROUP_DEPTH = 3;
  protected repository: AttributeRepository;
  protected uniqueFields: (keyof Attribute)[] = ["name"];
  protected uniqueScope: (keyof Attribute)[] = ["type", "storeId"];
  protected searchableFields = ["name"];
  protected shouldAttachFiles(): boolean {
    return false;
  }

  constructor(
    @inject(ATTRIBUTE_TYPES.AttributeRepository)
    repository: AttributeRepository,
  ) {
    super();
    this.repository = repository;
  }

  async validateBeforeUpdate(
    id: string,
    data: DeepPartial<Attribute>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    const existing = await this.getById(id, req, manager);
    this.validateStoreAccess(existing, req);
    const canUpdate = await this.canUpdate(existing, req);
    if (!canUpdate.can) throw new BadRequestError(canUpdate.reason);
    this.validateStoreScopeForWrite(data, existing, req);
    await this.validateHierarchy(id, data, manager, existing);
  }

  async validateBeforeCreate(
    data: DeepPartial<Attribute>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    this.attachStoreScope(data, req);
    await this.validateHierarchy(undefined, data, manager);
  }

  private attachStoreScope(
    data: DeepPartial<Attribute>,
    req?: RequestContext,
  ): void {
    if (isStoreScopedAttributeType(data.type)) {
      const contextStoreId = req?.storeContext?.storeId;

      if (!contextStoreId && !data.storeId) {
        throw new ValidationError("Vui lòng chọn cửa hàng", "storeId");
      }

      data.storeId = contextStoreId || data.storeId;
      return;
    }

    data.storeId = null;
  }

  private validateStoreAccess(entity: Attribute, req?: RequestContext): void {
    if (!entity.storeId) return;
    const contextStoreId = req?.storeContext?.storeId;
    if (contextStoreId && contextStoreId !== entity.storeId) {
      throw new BadRequestError("attribute.store_forbidden", [
        {
          field: "storeId",
          message: "Không có quyền truy cập thuộc tính của cửa hàng khác",
        },
      ]);
    }
  }

  private validateStoreScopeForWrite(
    data: DeepPartial<Attribute>,
    existing: Attribute,
    req?: RequestContext,
  ): void {
    const type = (data.type || existing.type) as AttributeType;
    const contextStoreId = req?.storeContext?.storeId;

    if (isStoreScopedAttributeType(type)) {
      const storeId = existing.storeId || contextStoreId;
      if (!storeId || (contextStoreId && storeId !== contextStoreId)) {
        throw new ValidationError("attribute.store_required", [
          {
            field: "storeId",
            message: "Thuộc tính này bắt buộc thuộc một cửa hàng",
          },
        ]);
      }
      if (data.storeId && data.storeId !== storeId) {
        throw new BadRequestError("attribute.store_invalid", [
          {
            field: "storeId",
            message: "Không thể chuyển thuộc tính sang cửa hàng khác",
          },
        ]);
      }
      data.storeId = storeId;
      return;
    }

    if (data.storeId) {
      throw new ValidationError("attribute.store_invalid", [
        {
          field: "storeId",
          message: "Thuộc tính dùng chung không được gắn cửa hàng",
        },
      ]);
    }
    data.storeId = null;
  }

  private async validateHierarchy(
    id: string | undefined,
    data: DeepPartial<Attribute>,
    manager: EntityManager,
    existing?: Attribute,
  ): Promise<void> {
    const type = (data.type || existing?.type) as AttributeType | undefined;
    const hasParentField = Object.prototype.hasOwnProperty.call(
      data,
      "parentId",
    );
    const parentId = hasParentField ? data.parentId : existing?.parentId;

    if (type !== AttributeType.PRODUCT_GROUP) {
      if (parentId) {
        throw new ValidationError("attribute.parent_invalid", [
          {
            field: "parentId",
            message: "Chỉ nhóm sản phẩm mới được phép có nhóm cha",
          },
        ]);
      }

      if (id && data.type && existing?.type === AttributeType.PRODUCT_GROUP) {
        const rows = await this.repository.getHierarchyRows(
          AttributeType.PRODUCT_GROUP,
          manager,
        );
        if (rows.some((row) => row.parentId === id)) {
          throw new ValidationError("attribute.type_invalid", [
            {
              field: "type",
              message: "Không thể đổi loại khi nhóm sản phẩm còn nhóm con",
            },
          ]);
        }
      }
      return;
    }

    const rows = await this.repository.getHierarchyRows(
      AttributeType.PRODUCT_GROUP,
      manager,
    );
    const parent = parentId ? rows.find((row) => row.id === parentId) : null;

    if (parentId && !parent) {
      throw new ValidationError("attribute.parent_not_found", [
        { field: "parentId", message: "Không tìm thấy nhóm sản phẩm cha" },
      ]);
    }

    if (parentId && id === parentId) {
      throw new ValidationError("attribute.parent_invalid", [
        {
          field: "parentId",
          message: "Nhóm sản phẩm không thể là cha của chính nó",
        },
      ]);
    }

    const parentById = new Map<string, string | null>(
      rows.map((row) => [row.id, row.parentId || null]),
    );
    if (id) parentById.set(id, parentId || null);

    if (id && parentId) {
      const visited = new Set<string>();
      let cursor: string | null = parentId;
      while (cursor) {
        if (cursor === id) {
          throw new ValidationError("attribute.parent_cycle", [
            {
              field: "parentId",
              message: "Không thể tạo vòng lặp nhóm sản phẩm",
            },
          ]);
        }
        if (visited.has(cursor)) break;
        visited.add(cursor);
        cursor = parentById.get(cursor) || null;
      }
    }

    const depthOf = (nodeId: string): number => {
      let depth = 1;
      let cursor = parentById.get(nodeId) || null;
      const visited = new Set<string>([nodeId]);
      while (cursor) {
        if (visited.has(cursor)) return Number.MAX_SAFE_INTEGER;
        visited.add(cursor);
        depth += 1;
        cursor = parentById.get(cursor) || null;
      }
      return depth;
    };

    if (
      !id &&
      parentId &&
      depthOf(parentId) + 1 > AttributeService.MAX_PRODUCT_GROUP_DEPTH
    ) {
      throw new ValidationError("attribute.depth_invalid", [
        {
          field: "parentId",
          message: `Nhóm sản phẩm chỉ được phép tối đa ${AttributeService.MAX_PRODUCT_GROUP_DEPTH} cấp`,
        },
      ]);
    }

    const idsToCheck = Array.from(parentById.keys());
    if (id && !idsToCheck.includes(id)) idsToCheck.push(id);
    if (
      idsToCheck.some(
        (nodeId) => depthOf(nodeId) > AttributeService.MAX_PRODUCT_GROUP_DEPTH,
      )
    ) {
      throw new ValidationError("attribute.depth_invalid", [
        {
          field: "parentId",
          message: `Nhóm sản phẩm chỉ được phép tối đa ${AttributeService.MAX_PRODUCT_GROUP_DEPTH} cấp`,
        },
      ]);
    }
  }

  async validateBeforeDelete(
    data: Attribute,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    this.validateStoreAccess(data, req);
    const canDelete = await this.canDelete(data, req);
    if (!canDelete.can) throw new BadRequestError(canDelete.reason);
  }
  protected async attachActions(
    entity: Attribute & { _actions?: ActionMap },
    req?: RequestContext,
  ): Promise<void> {
    entity._actions = await this.getActions(entity, req);
  }

  private async getActions(
    entity: Attribute | null,
    req?: RequestContext,
  ): Promise<ActionMap> {
    const actions = this.getDefaultAction();
    if (!entity) return actions;
    actions.update = await this.canUpdate(entity, req);
    actions.delete = await this.canDelete(entity, req);
    return actions;
  }

  async canUpdate(
    entity: Attribute,
    req?: RequestContext,
  ): Promise<ActionValue> {
    if (entity.isDefault)
      return {
        can: false,
        reason: "Không thể sửa thuộc tính mặc định của hệ thống",
      };

    return { can: true };
  }

  async canDelete(
    entity: Attribute,
    req?: RequestContext,
  ): Promise<ActionValue> {
    if (entity.isDefault)
      return {
        can: false,
        reason: "Không thể xóa thuộc tính mặc định của hệ thống",
      };
    return { can: true };
  }

  /**
   * Tìm attribute theo tên + type (không phân biệt hoa thường).
   * Nếu không có thì tự động tạo mới.
   * Trả về { id, name } để dùng làm snapshot.
   */
  async findOrCreate(
    name: string,
    type: AttributeType,
    req?: RequestContext,
  ): Promise<{ id: string; name: string }> {
    const id = await this.repository.findOrCreateAttribute({ name, type }, req);
    const attribute = await this.repository.findById(id);
    if (!attribute) throw new Error("attribute.not_found");
    return { id: attribute.id, name: attribute.name };
  }
}
