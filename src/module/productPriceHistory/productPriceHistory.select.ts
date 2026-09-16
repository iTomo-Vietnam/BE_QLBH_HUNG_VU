import { FindOptionsRelations, FindOptionsSelect } from "typeorm";
import { BaseSelect } from "@/shared/base/BaseSelect";
import { ProductPriceHistory } from "@/database/models/store/ProductPriceHistory";

export const ProductPriceHistorySelectList: FindOptionsSelect<ProductPriceHistory> = {
  ...BaseSelect, storeId: true, code: true, occurredAt: true, productId: true,
  purchaseLineId: true, productSnapshot: true,
  costPrice: true, deltaCostPrice: true,
  store: { id: true, code: true, name: true },
};
export const ProductPriceHistorySelectFull: FindOptionsSelect<ProductPriceHistory> = {
  ...ProductPriceHistorySelectList,
  product: { id: true, code: true, name: true, baseUnitId: true },
  store: { id: true, code: true, name: true },
} as any;
export const ProductPriceHistoryRelationsList: FindOptionsRelations<ProductPriceHistory> = { store: true };
export const ProductPriceHistoryRelations: FindOptionsRelations<ProductPriceHistory> = { product: true, store: true };
