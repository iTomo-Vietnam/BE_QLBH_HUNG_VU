import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager, SelectQueryBuilder } from "typeorm";
import { BaseRepository } from "@/shared/base/BaseRepository";
import { AttributeType, Product, ProductSnapshot } from "@/database/models";
import { IFindPaginationOptions } from "@/shared/base/BaseRepository";
import { AttributeRepository } from "../attribute/attribute.repository";
import { ATTRIBUTE_TYPES } from "../attribute/attribute.types";
import {
  ProductRelations,
  ProductRelationsList,
  ProductSelectFull,
  ProductSelectList,
} from "./product.select";
import { ProductQueryDto } from "./product.validator";
import { STORE_PRODUCT_TYPES } from "../storeProduct/storeProduct.types";
import { StoreProductRepository } from "../storeProduct/storeProduct.repository";

@injectable()
export class ProductRepository extends BaseRepository<Product> {
  protected entityClass = Product;
  protected selectedFields = ProductSelectFull;
  protected selectedFieldsForList = ProductSelectList;
  protected relations = ProductRelations;
  protected relationsForList = ProductRelationsList;

  constructor(
    @inject(ATTRIBUTE_TYPES.AttributeRepository)
    private attributeRepository: AttributeRepository,
    @inject(STORE_PRODUCT_TYPES.Repository)
    private storeProductRepository: StoreProductRepository,
  ) {
    super();
  }

  protected async extendQueryBuilder(
    qb: SelectQueryBuilder<Product>,
    options: IFindPaginationOptions<Product>,
  ): Promise<void> {
    const accessibleStoreIds = options.moreQuery?.accessibleStoreIds as string[] | undefined;
    if (Array.isArray(accessibleStoreIds)) {
      if (accessibleStoreIds.length === 0) {
        qb.andWhere("1 = 0");
      } else {
        qb.innerJoin(`${qb.alias}.storeProducts`, "accessStoreProduct");
        qb.andWhere("accessStoreProduct.storeId IN (:...accessibleStoreIds)", {
          accessibleStoreIds,
        });
      }
    }
    const {
      productGroupId,
      productGroupIds,
      brandId,
      brandIds,
      locationId,
      locationIds,
    } = (options.moreQuery as ProductQueryDto) || {};

    // TODO: Lọc theo nhóm hàng hóa
    if (productGroupId) {
      qb.andWhere(`${qb.alias}.groupId = :productGroupId`, {
        productGroupId,
      });
    } else if (this.checkArrayFilter(productGroupIds)) {
      const groupIds = await this.attributeRepository.getDescendantIds(
        productGroupIds!,
        AttributeType.PRODUCT_GROUP,
      );

      qb.andWhere(`${qb.alias}.groupId IN (:...productGroupIds)`, {
        productGroupIds: groupIds,
      });
    }

    // TODO: Lọc theo thương hiệu
    if (brandId) {
      qb.andWhere(`${qb.alias}.brandId = :brandId`, { brandId });
    } else if (this.checkArrayFilter(brandIds)) {
      qb.andWhere(`${qb.alias}.brandId IN (:...brandIds)`, { brandIds });
    }

    // TODO: Lọc theo vị trí kho/kệ
    // Join vào storeProducts, storeProduct.locationIds
    if (locationId) {
      qb.innerJoin(`${qb.alias}.storeProducts`, "storeProduct").andWhere(
        ":locationId = ANY(storeProduct.locationIds)",
        { locationId },
      );
    } else if (this.checkArrayFilter(locationIds)) {
      qb.innerJoin(`${qb.alias}.storeProducts`, "storeProduct").andWhere(
        "storeProduct.locationIds && :locationIds",
        { locationIds },
      );
    }
  }

  /**
   * Tính tồn cho một variant của product
   * @param variantId
   * @param storeId
   * @returns
   */
  async calculateStock(
    data: Product | string,
    storeId?: string,
  ): Promise<{
    stockQuantity: number;
    stockValue: number;
  }> {
    const product = typeof data === "string" ? await this.getById(data) : data;
    return storeId
      ? {
          stockQuantity:
            Number(product?.stockMetadata?.byStore?.[storeId]?.quantity) || 0,
          stockValue:
            Number(product?.stockMetadata?.byStore?.[storeId]?.value) || 0,
        }
      : {
          stockQuantity: Number(product?.stockMetadata?.total?.quantity) || 0,
          stockValue: Number(product?.stockMetadata?.total?.value) || 0,
        };
  }

  async attachInfo<
    T extends {
      productId?: string | null;
      productSnapshot?: DeepPartial<ProductSnapshot> | null;
    },
  >(
    data: T,
    manager?: EntityManager,
    rawProduct?: Product | null,
  ): Promise<void> {
    if (
      data.productId &&
      (!data.productSnapshot || data.productSnapshot.id !== data.productId)
    )
      data.productSnapshot = await this.getSnapshot(
        rawProduct || data.productId,
        manager,
      );
  }

  async attachUnitConversion<
    T extends {
      productId?: string | null;
      unitId?: string | null;
      conversionRateAtTime?: number | null;
    },
  >(
    data: T,
    manager?: EntityManager,
    rawProduct?: Product | null,
  ): Promise<void> {
    if (!data.productId || !data.unitId) {
      data.conversionRateAtTime = 1;
      return;
    }
    const product = rawProduct
      ? rawProduct
      : await this.getRepository(manager).findOne({
          where: { id: data.productId },
          relations: { extraUnits: true },
        });

    const unit = product?.extraUnits?.find(
      (item) => item.unitId === data.unitId,
    );
    data.conversionRateAtTime =
      product?.baseUnitId === data.unitId
        ? 1
        : Number(unit?.conversionRate) || 1;
  }

  async getUnitCost(
    productId: string,
    unitId: string,
    storeId?: string,
    manager?: EntityManager,
    rawProduct?: Product | null,
  ): Promise<number> {
    if (storeId) {
      const storeProduct = await this.storeProductRepository
        .getRepository(manager)
        .findOne({ where: { productId, storeId } });
      if (storeProduct) return Number(storeProduct.costPrice) || 0;
    }
    const product = rawProduct
      ? rawProduct
      : await this.getRepository(manager).findOne({
          where: { id: productId },
          relations: { extraUnits: true },
        });
    if (!product) return 0;
    const extra = product.extraUnits?.find((item) => item.unitId === unitId);
    return product.baseUnitId === unitId ? 0 : Number(extra?.salePrice) || 0;
  }

  async attachCostInfo<
    T extends {
      productId?: string | null;
      unitId?: string | null;
      storeId?: string | null;
      quantity?: number | null;
      costPriceAtTime?: number | null;
      totalCost?: number | null;
    },
  >(
    data: T,
    manager?: EntityManager,
    rawProduct?: Product | null,
  ): Promise<void> {
    if (!data.productId || !data.unitId) return;
    await this.attachUnitConversion(data, manager, rawProduct);
    data.costPriceAtTime = await this.getUnitCost(
      data.productId,
      data.unitId,
      data.storeId || undefined,
      manager,
      rawProduct,
    );
    data.totalCost =
      (Number(data.quantity) || 0) * (Number(data.costPriceAtTime) || 0);
  }

  async getSnapshot(
    data: Product | string,
    manager?: EntityManager,
  ): Promise<ProductSnapshot | null> {
    const isString = typeof data === "string";
    const product = isString
      ? await this.getRepository(manager).findOne({
          where: { id: data } as any,
        })
      : data;

    return product
      ? { id: product.id, code: product.code, name: product.name }
      : null;
  }
}
