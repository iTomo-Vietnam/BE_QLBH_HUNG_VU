import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager, IsNull, LessThan } from "typeorm";
import { BaseService } from "@/shared/base/BaseService";
import { RequestContext } from "@/shared/types/interfaces";
import { ProductPriceHistory } from "@/database/models/store/ProductPriceHistory";
import { ProductPriceHistoryRepository } from "./productPriceHistory.repository";
import { PRODUCT_PRICE_HISTORY_TYPES } from "./productPriceHistory.types";
import { INVENTORY_TYPES } from "../inventory/inventory.types";
import { InventoryRecalculateService } from "../inventory/inventoryRecalculate.service";
import { PRODUCT_TYPES } from "../product/product.types";
import { ProductRepository } from "../product/product.repository";
import { STORE_PRODUCT_TYPES } from "../storeProduct/storeProduct.types";
import { StoreProductRepository } from "../storeProduct/storeProduct.repository";

@injectable()
export class ProductPriceHistoryService extends BaseService<ProductPriceHistory> {
  protected repository: ProductPriceHistoryRepository;

  constructor(
    @inject(PRODUCT_PRICE_HISTORY_TYPES.Repository)
    repository: ProductPriceHistoryRepository,
    @inject(INVENTORY_TYPES.InventoryRecalculateService)
    private readonly inventory: InventoryRecalculateService,
    @inject(PRODUCT_TYPES.ProductRepository)
    private readonly productRepository: ProductRepository,
    @inject(STORE_PRODUCT_TYPES.Repository)
    private readonly storeProductRepository: StoreProductRepository,
  ) {
    super();
    this.repository = repository;
    this.searchableFields = ["code"];
    this.timeField = "occurredAt";
  }

  async findById(
    id: string,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<ProductPriceHistory | null> {
    const storeId = req?.storeContext?.storeId || req?.storeContext?.storeId;
    return this.repository.findOne(
      { where: { id, ...(storeId ? { storeId } : {}) } as any },
      manager,
    );
  }

  async validateBeforeCreate(
    data: DeepPartial<ProductPriceHistory>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    const payload = data as Partial<ProductPriceHistory>;
    const contextStoreId =
      req?.storeContext?.storeId || req?.storeContext?.storeId;
    const storeId = payload.storeId || contextStoreId;
    if (!storeId) throw new Error("productPriceHistory.store.required");
    if (contextStoreId && payload.storeId && payload.storeId !== contextStoreId)
      throw new Error("store.scope.mismatch");
    if (!payload.productId)
      throw new Error("productPriceHistory.product.required");

    const costPrice = Number(payload.costPrice);
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      throw new Error("productPriceHistory.costPrice.invalid");
    }

    const productSnapshot = await this.productRepository.getSnapshot(
      payload.productId,
      manager,
    );
    if (!productSnapshot) throw new Error("product.not_found");
    payload.occurredAt = payload.occurredAt || new Date();
    const historyBefore = await this.repository.getRepository(manager).findOne({
      where: {
        productId: payload.productId,
        storeId,
        occurredAt: LessThan(payload.occurredAt),
        deletedAt: IsNull(),
      } as any,
      order: { occurredAt: "DESC", createdAt: "DESC", id: "DESC" } as any,
    });
    const storeProduct = await this.storeProductRepository
      .getRepository(manager)
      .findOne({ where: { productId: payload.productId, storeId } as any });
    const before =
      Number(historyBefore?.costPrice ?? storeProduct?.costPrice) || 0;

    payload.storeId = storeId;
    payload.productSnapshot = productSnapshot;
    payload.deltaCostPrice = costPrice - before;
  }

  async actionAfterCreate(
    data: ProductPriceHistory,
    manager: EntityManager,
  ): Promise<void> {
    const storeProductRepository =
      this.storeProductRepository.getRepository(manager);
    const current = await storeProductRepository.findOne({
      where: { productId: data.productId!, storeId: data.storeId } as any,
    });
    await storeProductRepository.save(
      storeProductRepository.create({
        ...(current || {}),
        productId: data.productId!,
        storeId: data.storeId,
        costPrice: data.costPrice,
      }),
    );
    await this.inventory.recalculateProductStoreFromDate(
      data.productId!,
      data.storeId,
      data.occurredAt,
      manager,
    );
  }

  async validateBeforeUpdate(): Promise<void> {
    throw new Error("productPriceHistory.immutable");
  }

  async validateBeforeDelete(): Promise<void> {
    throw new Error("productPriceHistory.immutable");
  }
}
