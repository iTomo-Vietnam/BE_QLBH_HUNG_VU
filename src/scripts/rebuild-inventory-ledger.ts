import "reflect-metadata";
import { IsNull, LessThan } from "typeorm";
import DatabaseConfig from "@/config/database";
import { container } from "@/config/container";
import { INVENTORY_TYPES } from "@/module/inventory/inventory.types";
import { InventoryRecalculateService } from "@/module/inventory/inventoryRecalculate.service";
import { Product } from "@/database/models/Product";
import { StoreProduct } from "@/database/models/store/StoreProduct";
import { ProductPriceHistory } from "@/database/models/store/ProductPriceHistory";
import {
  Order,
  OrderStatus,
  OrderType,
} from "@/database/models/store/Order";
import { generateCode } from "@/shared/utils/code.utils";

const EPSILON = 0.000001;

async function createMissingInitialHistories(
  manager: any,
): Promise<number> {
  const storeProductRepository = manager.getRepository(StoreProduct);
  const historyRepository = manager.getRepository(ProductPriceHistory);
  const storeProducts = await storeProductRepository.find({
    relations: { product: true },
  });
  const existingHistories = await historyRepository.find({
    select: { productId: true, storeId: true } as any,
    where: { deletedAt: IsNull() } as any,
  });
  const existingKeys = new Set(
    existingHistories.map(
      (history: ProductPriceHistory) =>
        `${history.productId}:${history.storeId}`,
    ),
  );
  let created = 0;

  for (const storeProduct of storeProducts) {
    const key = `${storeProduct.productId}:${storeProduct.storeId}`;
    if (existingKeys.has(key)) continue;

    const product = storeProduct.product as Product | null;
    const costPrice = Number(storeProduct.costPrice) || 0;
    const history = historyRepository.create({
      storeId: storeProduct.storeId,
      productId: storeProduct.productId,
      productSnapshot: product
        ? { id: product.id, code: product.code, name: product.name }
        : null,
      code: await generateCode("pricehistory", storeProduct.storeId),
      occurredAt: product?.createdAt || storeProduct.createdAt || new Date(),
      creatorId: product?.creatorId || null,
      creatorSnapshot: product?.creatorSnapshot || null,
      costPrice,
      deltaCostPrice: costPrice,
      purchaseLineId: null,
    });
    await historyRepository.save(history);
    existingKeys.add(key);
    created += 1;
  }
  return created;
}

async function createMissingPurchaseHistories(manager: any): Promise<number> {
  const orderRepository = manager.getRepository(Order);
  const storeProductRepository = manager.getRepository(StoreProduct);
  const historyRepository = manager.getRepository(ProductPriceHistory);
  const orders = await orderRepository.find({
    where: {
      type: OrderType.PURCHASE,
      status: OrderStatus.COMPLETED,
      deletedAt: IsNull(),
    } as any,
    relations: { lines: true },
    order: { occurredAt: "ASC", id: "ASC" } as any,
  });
  let created = 0;

  for (const order of orders) {
    const occurredAt = order.occurredAt || order.orderAt;
    for (const line of order.lines || []) {
      if (!line.id || !line.productId) continue;
      const exists = await historyRepository.exist({
        where: { purchaseLineId: line.id, deletedAt: IsNull() } as any,
      });
      if (exists) continue;

      const rate = Number(line.conversionRateAtTime) || 1;
      const costPrice = (Number(line.unitPrice) || 0) / rate;
      const previous = await historyRepository.findOne({
        where: {
          productId: line.productId,
          storeId: order.storeId,
          occurredAt: LessThan(occurredAt),
          deletedAt: IsNull(),
        } as any,
        order: { occurredAt: "DESC", createdAt: "DESC", id: "DESC" } as any,
      });
      const storeProduct = await storeProductRepository.findOne({
        where: { productId: line.productId, storeId: order.storeId } as any,
      });
      const before = Number(previous?.costPrice ?? storeProduct?.costPrice) || 0;
      if (Math.abs(costPrice - before) < EPSILON) continue;

      const snapshot = line.productSnapshot || null;
      await historyRepository.save(
        historyRepository.create({
          storeId: order.storeId,
          productId: line.productId,
          purchaseLineId: line.id,
          productSnapshot: snapshot,
          code: await generateCode("pricehistory", order.storeId),
          occurredAt,
          creatorId: order.completerId || order.creatorId || null,
          creatorSnapshot: order.completerSnapshot || order.creatorSnapshot || null,
          costPrice,
          deltaCostPrice: costPrice - before,
        }),
      );
      created += 1;
    }
  }
  return created;
}

async function loadInventoryNodes(): Promise<Array<{ productId: string; storeId: string }>> {
  // Không cần replay các StoreProduct chưa từng phát sinh nghiệp vụ. Với dữ liệu
  // lớn, replay toàn bộ store_products sẽ vừa chậm vừa tạo tải không cần thiết.
  const rows = await DatabaseConfig.query(`
    SELECT DISTINCT "productId", "storeId"
    FROM inventory_transactions
    WHERE "deletedAt" IS NULL

    UNION

    SELECT DISTINCT ol."productId", o."storeId"
    FROM orders o
    INNER JOIN order_lines ol
      ON (ol."orderId" = o.id OR ol."returnOrderId" = o.id)
    WHERE o."deletedAt" IS NULL
      AND ol."deletedAt" IS NULL
      AND o.status = 'completed'

    UNION

    SELECT DISTINCT ial."productId", ia."storeId"
    FROM inventory_adjustments ia
    INNER JOIN inventory_adjustment_lines ial
      ON ial."adjustmentId" = ia.id
    WHERE ia."deletedAt" IS NULL
      AND ial."deletedAt" IS NULL

    UNION

    SELECT DISTINCT stl."productId", st."fromStoreId"
    FROM store_transfers st
    INNER JOIN store_transfer_lines stl
      ON stl."transferId" = st.id
    WHERE st."deletedAt" IS NULL
      AND stl."deletedAt" IS NULL
      AND st.status <> 'planned'

    UNION

    SELECT DISTINCT stl."productId", st."toStoreId"
    FROM store_transfers st
    INNER JOIN store_transfer_lines stl
      ON stl."transferId" = st.id
    WHERE st."deletedAt" IS NULL
      AND stl."deletedAt" IS NULL
      AND st.status <> 'planned'

    UNION

    SELECT DISTINCT iel."productId", ie."storeId"
    FROM internal_exports ie
    INNER JOIN internal_export_lines iel
      ON iel."internalExportId" = ie.id
    WHERE ie."deletedAt" IS NULL
      AND iel."deletedAt" IS NULL

    UNION

    SELECT DISTINCT h."productId", h."storeId"
    FROM product_price_histories h
    WHERE h."deletedAt" IS NULL
      -- Lịch sử tạo lúc khởi tạo sản phẩm đã có sẵn trong loadEvents khi
      -- replay một node có nghiệp vụ. Không dùng nó để biến mọi
      -- store_product thành một node replay.
      AND h."purchaseLineId" IS NOT NULL
  `);

  return rows
    .filter((row: any) => row.productId && row.storeId)
    .map((row: any) => ({
      productId: String(row.productId),
      storeId: String(row.storeId),
    }));
}

async function main(): Promise<void> {
  await DatabaseConfig.initialize();
  let initialCount = 0;
  let purchaseCount = 0;
  await DatabaseConfig.transaction(async (manager) => {
    initialCount = await createMissingInitialHistories(manager as any);
  });
  await DatabaseConfig.transaction(async (manager) => {
    purchaseCount = await createMissingPurchaseHistories(manager as any);
  });

  const inventory = container.get<InventoryRecalculateService>(
    INVENTORY_TYPES.InventoryRecalculateService,
  );
  const requestedProductId = process.env.INVENTORY_REBUILD_PRODUCT_ID;
  const allNodes = await loadInventoryNodes();
  const nodes = requestedProductId
    ? allNodes.filter((node) => node.productId === requestedProductId)
    : allNodes;
  if (requestedProductId && !nodes.length) {
    throw new Error(
      `Không tìm thấy inventory node cho productId ${requestedProductId}`,
    );
  }
  console.log(`Inventory nodes selected: ${nodes.length}`);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    await inventory.recalculateProductStoreFromDate(
      node.productId,
      node.storeId,
      new Date(0),
    );
    if ((index + 1) % 25 === 0 || index + 1 === nodes.length)
      console.log(`Inventory replayed ${index + 1}/${nodes.length} nodes`);
  }
  console.log(
    `Inventory rebuilt: ${initialCount} initial price histories, ${purchaseCount} purchase price histories`,
  );
  await DatabaseConfig.destroy();
}

main().catch(async (error) => {
  console.error("Inventory rebuild failed:", error);
  if (DatabaseConfig.isInitialized) await DatabaseConfig.destroy();
  process.exitCode = 1;
});
