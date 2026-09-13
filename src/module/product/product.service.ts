import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager, In, IsNull } from "typeorm";
import { BaseService } from "@/shared/base/BaseService";
import { AttributeType, Product } from "@/database/models";
import { ProductPriceHistory } from "@/database/models/store/ProductPriceHistory";
import { StoreProduct } from "@/database/models/store/StoreProduct";
import { ProductExtraUnit } from "@/database/models/ProductExtraUnit";
import { StoreProductLocation } from "@/database/models/store/StoreProductLocation";
import { ProductRepository } from "./product.repository";
import { PRODUCT_TYPES } from "./product.types";
import { CreateProductDto, ProductQueryDto } from "./product.validator";
import { RequestContext } from "@/shared/types/interfaces";
import { generateCode } from "@/shared/utils/code.utils";
import { InventoryRecalculateService } from "../inventory/inventoryRecalculate.service";
import { INVENTORY_TYPES } from "../inventory/inventory.types";
import { withTransaction } from "@/shared/base/TransactionManager";
import {
  BadRequestError,
  NotFoundError,
  ValidationError,
} from "@/shared/types/errors";
import { AttributeRepository } from "../attribute/attribute.repository";
import { ATTRIBUTE_TYPES } from "../attribute/attribute.types";
import { STORE_PRODUCT_TYPES } from "../storeProduct/storeProduct.types";
import { StoreProductRepository } from "../storeProduct/storeProduct.repository";
import { PRODUCT_PRICE_HISTORY_TYPES } from "../productPriceHistory/productPriceHistory.types";
import { ProductPriceHistoryRepository } from "../productPriceHistory/productPriceHistory.repository";

@injectable()
export class ProductService extends BaseService<Product> {
  protected repository: ProductRepository;
  protected uniqueFields: (keyof Product)[] = ["code"];
  protected searchableFields = ["name", "code", "note"];
  constructor(
    @inject(PRODUCT_TYPES.ProductRepository) repository: ProductRepository,
    @inject(ATTRIBUTE_TYPES.AttributeRepository)
    private attributeRepository: AttributeRepository,
    @inject(INVENTORY_TYPES.InventoryRecalculateService)
    private inventory: InventoryRecalculateService,
    @inject(STORE_PRODUCT_TYPES.Repository)
    private storeProductRepository: StoreProductRepository,
    @inject(PRODUCT_PRICE_HISTORY_TYPES.Repository)
    private priceHistoryRepository: ProductPriceHistoryRepository,
  ) {
    super();
    this.repository = repository;
  }

  protected async attachMoreDataToEntities(
    entities: Product[],
    req?: RequestContext,
  ): Promise<void> {
    for (const entity of entities) {
      await this.attachMoreDataToEntity(entity, req);
    }
  }

  protected async attachMoreDataToEntity(
    entity: Product,
    req?: RequestContext,
  ): Promise<void> {
    const storeId = req?.storeContext?.storeId;
    const { stockQuantity, stockValue } = await this.repository.calculateStock(
      entity,
      storeId,
    );
    entity.stockQuantity = stockQuantity;
    entity.stockValue = stockValue;
  }

  async validateBeforeCreate(
    data: DeepPartial<Product> & CreateProductDto,
    _manager: EntityManager,
    _req?: RequestContext,
  ): Promise<void> {
    delete (data as any).storeProducts;
    await this.validateExtraUnits((data as any).extraUnits, _manager);
    await this.validateProductGroup(data.groupId, _manager);
    await this.validateProductBrand(data.brandId, _manager);

    if (data.salePrice == null) data.salePrice = 0;
    if (!data.code) data.code = await generateCode("product");
    this.fillBarcodeIfEmpty(data, data.code);
  }
  async validateBeforeUpdate(
    id: string,
    data: DeepPartial<Product>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    if (
      Object.prototype.hasOwnProperty.call(data, "barcode") &&
      !String(data.barcode ?? "").trim()
    ) {
      const existing = await this.getById(id, req, manager);
      this.fillBarcodeIfEmpty(data, data.code || existing.code);
    }
    if (Array.isArray((data as any).extraUnits)) {
      await this.validateExtraUnits((data as any).extraUnits, manager);
      // BaseRepository.update uses UPDATE ... SET and cannot update a OneToMany.
      // The original array is kept in BaseService.inputData for syncExtraUnits().
      delete (data as any).extraUnits;
    }
    delete (data as any).storeProducts;
    await this.validateProductGroup(data.groupId, manager);
    await this.validateProductBrand(data.brandId, manager);
  }

  private fillBarcodeIfEmpty(
    data: DeepPartial<Product>,
    code?: string | null,
  ): void {
    if (String(data.barcode ?? "").trim() || !code) return;

    const digits = code.replace(/[^0-9]/g, "");
    data.barcode = digits.padStart(8, "0");
  }

  async actionAfterCreate(
    data: Product,
    manager: EntityManager,
    req?: RequestContext,
    inputData?: DeepPartial<Product>,
  ): Promise<void> {
    await this.syncStoreProducts(
      data.id,
      (inputData as any)?.storeProducts,
      manager,
      req,
    );
  }

  async actionAfterUpdate(
    data: Product,
    manager: EntityManager,
    req?: RequestContext,
    inputData?: DeepPartial<Product>,
  ): Promise<void> {
    if (Array.isArray((inputData as any)?.storeProducts)) {
      await this.syncStoreProducts(
        data.id,
        (inputData as any).storeProducts,
        manager,
        req,
      );
    }
    if (Array.isArray((inputData as any)?.extraUnits)) {
      await this.syncExtraUnits(
        data.id,
        (inputData as any).extraUnits,
        manager,
      );
    }
  }

  private async validateExtraUnits(
    rows: any,
    _manager: EntityManager,
  ): Promise<void> {
    if (!Array.isArray(rows)) return;

    const unitIds = rows.map((row) => row?.unitId).filter(Boolean);
    if (new Set(unitIds).size !== unitIds.length) {
      throw new ValidationError("input.invalid", [
        { field: "extraUnits", message: "Không được chọn trùng đơn vị tính" },
      ]);
    }

    const purchaseUnits = rows.filter((row) => row?.isPurchaseUnit === true);
    if (purchaseUnits.length > 1) {
      throw new ValidationError("input.invalid", [
        {
          field: "extraUnits",
          message: "Chỉ được chọn một đơn vị tính nhập hàng mặc định",
        },
      ]);
    }
  }

  private async syncExtraUnits(
    productId: string,
    rows: any[],
    manager: EntityManager,
  ): Promise<void> {
    const repo = manager.getRepository(ProductExtraUnit);
    await repo.delete({ productId } as any);

    if (!rows.length) return;

    await repo.save(
      rows.map((row) =>
        repo.create({
          id: row.id,
          productId,
          unitId: row.unitId,
          conversionRate: Number(row.conversionRate) || 1,
          salePrice: Number(row.salePrice) || 0,
          isPurchaseUnit: row.isPurchaseUnit === true,
        }),
      ),
    );
  }

  private async syncStoreProducts(
    productId: string,
    rows: any,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    if (!Array.isArray(rows)) return;

    // In a store context, only the current store row is writable. Other rows
    // may still be returned to FE, but must never be updated or removed here.
    const contextStoreId = req?.storeContext?.storeId;
    const editableRows = contextStoreId
      ? rows.filter((row) => row?.storeId === contextStoreId)
      : rows;
    const storeIds = editableRows.map((row) => row?.storeId).filter(Boolean);
    if (new Set(storeIds).size !== storeIds.length) {
      throw new ValidationError("input.invalid", [
        { field: "storeProducts", message: "Không được chọn trùng chi nhánh" },
      ]);
    }

    const repo = this.storeProductRepository.getRepository(manager);
    const locationRepo = manager.getRepository(StoreProductLocation);
    const existing = await repo.find({
      where: { productId } as any,
      withDeleted: true,
    });
    const editableExisting = contextStoreId
      ? existing.filter((item) => item.storeId === contextStoreId)
      : existing;
    const incomingIds = new Set(storeIds);

    for (const [rowIndex, row] of editableRows.entries()) {
      const current = editableExisting.find(
        (item) => item.storeId === row.storeId,
      );
      const locationIds = Array.from(
        new Set<string>(
          (Array.isArray(row.locationIds)
            ? row.locationIds
            : row.locationId
              ? [row.locationId]
              : []
          ).filter(Boolean),
        ),
      );
      await this.validateStoreProductLocations(
        row.storeId,
        locationIds,
        manager,
        rowIndex,
      );

      const savedStoreProduct = (await repo.save(
        repo.create({
          ...(current || {}),
          productId,
          storeId: row.storeId,
          costPrice: Number(row.costPrice) || 0,
          isSelling: row.isSelling !== false,
          deletedAt: null,
        } as any),
      )) as unknown as StoreProduct;

      await locationRepo.delete({ storeProductId: savedStoreProduct.id });
      if (locationIds.length) {
        await locationRepo.save(
          locationIds.map((locationId) =>
            locationRepo.create({
              storeProductId: savedStoreProduct.id,
              locationId,
            }),
          ),
        );
      }
    }

    const removedIds = editableExisting
      .filter((item) => !incomingIds.has(item.storeId) && !item.deletedAt)
      .map((item) => item.id);
    if (removedIds.length) await repo.softDelete(removedIds);
  }

  private async validateStoreProductLocations(
    storeId: string,
    locationIds: string[],
    manager: EntityManager,
    rowIndex: number,
  ): Promise<void> {
    if (!locationIds.length) return;

    const locations = await this.attributeRepository
      .getRepository(manager)
      .find({
        where: { id: In(locationIds) } as any,
      });
    const valid =
      locations.length === locationIds.length &&
      locations.every(
        (location) =>
          location.type === AttributeType.LOCATION &&
          location.storeId === storeId,
      );
    if (!valid) {
      throw new ValidationError("input.invalid", [
        {
          field: `storeProducts.${rowIndex}.locationIds`,
          message: "Vị trí phải là vị trí thuộc đúng chi nhánh",
        },
      ]);
    }
  }

  private async validateProductGroup(
    groupId: string | null | undefined,
    manager: EntityManager,
  ): Promise<void> {
    if (!groupId) return;
    const group = await this.attributeRepository.getById(groupId, manager);
    if (!group || group.type !== AttributeType.PRODUCT_GROUP) {
      throw new ValidationError("product.group_invalid", [
        { field: "groupId", message: "Nhóm sản phẩm không hợp lệ" },
      ]);
    }
  }

  async changeGroup(
    ids: string[],
    groupId: string | null | undefined,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<number> {
    const uniqueIds = Array.from(new Set(ids));
    const run = async (em: EntityManager) => {
      await this.validateProductGroup(groupId, em);

      const products = await this.repository.getRepository(em).find({
        select: { id: true },
        where: { id: In(uniqueIds), deletedAt: IsNull() } as any,
      });
      if (products.length !== uniqueIds.length) {
        throw new NotFoundError("Không tìm thấy một hoặc nhiều hàng hóa");
      }

      const result = await this.repository
        .getRepository(em)
        .update(
          { id: In(uniqueIds), deletedAt: IsNull() } as any,
          { groupId: groupId || null } as any,
        );
      return result.affected || 0;
    };

    return manager ? run(manager) : withTransaction(run);
  }

  async stopSelling(
    ids: string[],
    storeId?: string,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<number> {
    const uniqueIds = Array.from(new Set(ids));
    const contextStoreId = req?.storeContext?.storeId;
    if (contextStoreId && storeId && contextStoreId !== storeId) {
      throw new BadRequestError("Không thể thao tác với cửa hàng khác");
    }

    const run = async (em: EntityManager) => {
      const products = await this.repository.getRepository(em).find({
        select: { id: true },
        where: { id: In(uniqueIds), deletedAt: IsNull() } as any,
      });
      if (products.length !== uniqueIds.length) {
        throw new NotFoundError("Không tìm thấy một hoặc nhiều hàng hóa");
      }

      const where: any = {
        productId: In(uniqueIds),
        deletedAt: IsNull(),
      };
      if (storeId) where.storeId = storeId;

      const result = await this.storeProductRepository
        .getRepository(em)
        .update(where, { isSelling: false });
      return result.affected || 0;
    };

    return manager ? run(manager) : withTransaction(run);
  }

  private async validateProductBrand(
    brandId: string | null | undefined,
    manager: EntityManager,
  ): Promise<void> {
    if (!brandId) return;
    const brand = await this.attributeRepository.getById(brandId, manager);
    if (brand.type !== AttributeType.BRAND) {
      throw new ValidationError("product.brand_invalid", [
        { field: "brandId", message: "Thương hiệu không hợp lệ" },
      ]);
    }
  }
  async updateStoreCost(
    productId: string,
    storeId: string,
    costPrice: number,
    manager?: EntityManager,
  ): Promise<void> {
    const run = async (em: EntityManager) => {
      const repo = this.storeProductRepository.getRepository(em);
      const current = await repo.findOne({
        where: { productId, storeId } as any,
      });
      const before = Number(current?.costPrice) || 0;
      const delta = costPrice - before;
      if (Math.abs(delta) < 0.000001) return;
      const productSnapshot = await this.repository.getSnapshot(productId, em);
      if (!productSnapshot) throw new Error("product.not_found");
      await repo.save(
        repo.create({ ...(current || {}), productId, storeId, costPrice }),
      );
      const history = await this.priceHistoryRepository.getRepository(em).save(
        this.priceHistoryRepository.getRepository(em).create({
          storeId,
          productId,
          productSnapshot,
          code: await generateCode("pricehistory", storeId),
          costPrice,
          deltaCostPrice: delta,
        }),
      );
      await this.inventory.recalculateProductStoreFromDate(
        productId,
        storeId,
        history.createdAt,
        em,
      );
    };
    if (manager) await run(manager);
    else await withTransaction(run);
  }
  async getPriceHistories(
    query: ProductQueryDto,
    req?: RequestContext,
  ): Promise<Product[]> {
    const options: any = {
      where: { deletedAt: null },
      relations: { extraUnits: true },
    };
    if (query.productCategoryIds?.length) {
      const categoryIds = await this.attributeRepository.getDescendantIds(
        query.productCategoryIds,
        AttributeType.PRODUCT_GROUP,
      );
      if (!categoryIds.length) return [];
      options.where.groupId = In(categoryIds);
    } else if (query.groupId) {
      options.where.groupId = query.groupId;
    }
    const products = await this.repository.find(options);
    const storeId = (query as any).storeId || req?.storeContext?.storeId;
    if (Array.isArray(req?.availableStoreIds) && storeId && !req.availableStoreIds.includes(storeId))
      return [];
    if (!storeId || !products.length) return products;
    const histories = await this.priceHistoryRepository.getRepository().find({
      where: {
        storeId,
        productId: (products as any).map((p: Product) => p.id),
      } as any,
      order: { createdAt: "DESC" } as any,
    });
    const map = new Map<string, ProductPriceHistory[]>();
    for (const history of histories)
      map.set(history.productId || "", [
        ...(map.get(history.productId || "") || []),
        history,
      ]);
    for (const product of products)
      product.priceHistories = map.get(product.id) || [];
    return products;
  }

  async getByCodes(codes: string[], req?: RequestContext): Promise<Product[]> {
    const normalizedCodes = Array.from(
      new Set(codes.map((code) => code.trim()).filter(Boolean)),
    );
    if (!normalizedCodes.length) return [];

    const where: any = { code: In(normalizedCodes), deletedAt: IsNull() };
    if (Array.isArray(req?.availableStoreIds)) {
      if (req.availableStoreIds.length === 0) return [];
      const storeProducts = await this.storeProductRepository.getRepository().find({
        where: { storeId: In(req.availableStoreIds) } as any,
        select: { productId: true } as any,
      });
      const productIds = [...new Set(storeProducts.map((item) => item.productId))];
      if (!productIds.length) return [];
      where.id = In(productIds);
    }
    const products = await this.repository.find({
      where,
      relations: {
        group: true,
        brand: true,
        baseUnit: true,
        extraUnits: { unit: true },
      },
    });
    await this.hydrateEntities(products, req);
    return products;
  }
}
