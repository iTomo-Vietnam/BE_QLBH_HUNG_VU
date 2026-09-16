import { inject, injectable } from "inversify";
import { EntityManager, IsNull, LessThan } from "typeorm";
import { TransactionService } from "@/shared/base/TransactionService";
import { TransactionType } from "@/shared/constants/enum";
import { Order, OrderStatus, OrderType } from "@/database/models/store/Order";
import { OrderLine } from "@/database/models/store/OrderLine";
import { InventoryAdjustment } from "@/database/models/store/InventoryAdjustment";
import {
  InventoryTransaction,
  InventoryRefType,
} from "@/database/models/store/InventoryTransaction";
import { ProductPriceHistory } from "@/database/models/store/ProductPriceHistory";
import {
  StoreTransfer,
  StoreTransferStatus,
} from "@/database/models/StoreTransfer";
import { INVENTORY_TYPES } from "./inventory.types";
import { StockMetadataHelper } from "./stockMetadata.helper";
import { PRODUCT_PRICE_HISTORY_TYPES } from "../productPriceHistory/productPriceHistory.types";
import { ProductPriceHistoryRepository } from "../productPriceHistory/productPriceHistory.repository";
import { STORE_PRODUCT_TYPES } from "../storeProduct/storeProduct.types";
import { StoreProductRepository } from "../storeProduct/storeProduct.repository";
import { ORDER_TYPES } from "../order/order.types";
import { OrderRepository } from "../order/order.repository";
import { OrderLineRepository } from "../order/orderLine.repository";
import { INVENTORY_ADJUSTMENT_TYPES } from "../inventoryAdjustment/inventoryAdjustment.types";
import { InventoryAdjustmentRepository } from "../inventoryAdjustment/inventoryAdjustment.repository";
import { STORE_TRANSFER_TYPES } from "../storeTransfer/storeTransfer.types";
import { StoreTransferRepository } from "../storeTransfer/storeTransfer.repository";
import { InventoryRepository } from "./inventory.repository";
import { PRODUCT_TYPES } from "../product/product.types";
import { ProductRepository } from "../product/product.repository";
import { InternalExport } from "@/database/models/store/InternalExport";
import { BadRequestError } from "@/shared/types/errors";

export interface InventoryRecalculateNode {
  productId: string;
  storeId: string;
  fromDate: Date | string;
}

type State = { quantity: number; value: number; cost: number };
type SourceEvent = {
  occurredAt: Date;
  order?: Order;
  adjustment?: InventoryAdjustment;
  transfer?: StoreTransfer;
  internalExport?: InternalExport;
  price?: ProductPriceHistory;
  sign?: 1 | -1;
  refType: InventoryRefType;
  refId: string;
  refCode?: string | null;
  quantity: number;
};

/**
 * Rebuilds the store/product ledger.  Every replayed row is a running state:
 * `inventoryValueAfter` is always exactly `costPriceAfter * quantityAfter`.
 * A price history is a value-only transaction (quantity = 0), so changing a
 * cost never gets mistaken for a stock movement.
 */
@injectable()
export class InventoryRecalculateService extends TransactionService {
  constructor(
    @inject(INVENTORY_TYPES.StockMetadataHelper)
    private readonly stockMetadata: StockMetadataHelper,
    @inject(PRODUCT_PRICE_HISTORY_TYPES.Repository)
    private priceRepository: ProductPriceHistoryRepository,
    @inject(STORE_PRODUCT_TYPES.Repository)
    private storeProductRepository: StoreProductRepository,
    @inject(ORDER_TYPES.OrderRepository)
    private orderRepository: OrderRepository,
    @inject(ORDER_TYPES.OrderLineRepository)
    private orderLineRepository: OrderLineRepository,
    @inject(INVENTORY_ADJUSTMENT_TYPES.Repository)
    private adjustmentRepository: InventoryAdjustmentRepository,
    @inject(STORE_TRANSFER_TYPES.Repository)
    private transferRepository: StoreTransferRepository,
    @inject(INVENTORY_TYPES.InventoryRepository)
    private transactionRepository: InventoryRepository,
    @inject(PRODUCT_TYPES.ProductRepository)
    private productRepository: ProductRepository,
  ) {
    super();
  }

  private async managerOf(manager?: EntityManager): Promise<EntityManager> {
    return manager || this.getManager();
  }

  private isReturn(type: OrderType): boolean {
    return type === OrderType.PURCHASE_RETURN || type === OrderType.SALE_RETURN;
  }

  private orderSign(type: OrderType): 1 | -1 {
    return type === OrderType.PURCHASE || type === OrderType.SALE_RETURN
      ? 1
      : -1;
  }

  private async costAt(
    productId: string,
    storeId: string,
    at: Date,
    manager: EntityManager,
  ): Promise<number> {
    const history = await this.priceRepository.getRepository(manager).findOne({
      where: {
        productId,
        storeId,
        createdAt: LessThan(at),
        deletedAt: IsNull(),
      } as any,
      order: { createdAt: "DESC", id: "DESC" } as any,
    });
    if (history) return Number(history.costPrice) || 0;
    const storeProduct = await this.storeProductRepository
      .getRepository(manager)
      .findOne({ where: { productId, storeId } as any });
    return Number(storeProduct?.costPrice) || 0;
  }

  private async loadEvents(
    productId: string,
    storeId: string,
    fromDate: Date,
    manager: EntityManager,
  ): Promise<SourceEvent[]> {
    const [orders, adjustments, transfers, internalExports, prices] =
      await Promise.all([
        this.orderRepository.getRepository(manager).find({
          where: {
            storeId,
            status: OrderStatus.COMPLETED,
            deletedAt: IsNull(),
          } as any,
          relations: { lines: true, returnLines: true },
        }),
        this.adjustmentRepository.getRepository(manager).find({
          where: { storeId, deletedAt: IsNull() } as any,
          relations: { lines: true },
        }),
        this.transferRepository.getRepository(manager).find({
          where: { deletedAt: IsNull() } as any,
          relations: { lines: true },
        }),
        manager.getRepository(InternalExport).find({
          where: { storeId, deletedAt: IsNull() } as any,
          relations: { lines: true },
        }),
        this.priceRepository
          .getRepository(manager)
          .find({ where: { storeId, productId, deletedAt: IsNull() } as any }),
      ]);
    const events: SourceEvent[] = [];

    for (const order of orders) {
      const at = order.occurredAt || order.orderAt;
      if (!at || at < fromDate) continue;
      const lines = [
        ...(order.lines || []),
        ...(order.returnLines || []),
      ].filter((line) => line.productId === productId && !line.deletedAt);
      for (const line of lines) {
        const quantity =
          Math.abs(Number(line.quantity) || 0) *
          (Number(line.conversionRateAtTime) || 1);
        if (!quantity) continue;
        events.push({
          occurredAt: at,
          order,
          sign: this.orderSign(order.type),
          refType: this.orderRefType(order.type),
          refId: order.id,
          refCode: order.code,
          quantity,
        });
      }
    }
    for (const adjustment of adjustments) {
      if (adjustment.occurredAt < fromDate) continue;
      for (const line of adjustment.lines || []) {
        if (line.productId !== productId || !line.adjustmentQuantity) continue;
        const quantity = Math.abs(Number(line.adjustmentQuantity) || 0);
        events.push({
          occurredAt: adjustment.occurredAt,
          adjustment,
          sign: Number(line.adjustmentQuantity) >= 0 ? 1 : -1,
          refType: InventoryRefType.ADJUST,
          refId: adjustment.id,
          refCode: adjustment.code,
          quantity,
        });
      }
    }
    for (const transfer of transfers) {
      const status = transfer.status || StoreTransferStatus.PLANNED;
      const exportAt =
        transfer.exportedAt ||
        (status !== StoreTransferStatus.PLANNED ? transfer.occurredAt : null);
      const importAt =
        transfer.importedAt ||
        (status === StoreTransferStatus.IMPORTED ? exportAt : null);
      const cancelAt = transfer.canceledAt || null;

      for (const line of transfer.lines || []) {
        if (line.productId !== productId || !line.quantity) continue;
        const quantity =
          Math.abs(Number(line.quantity) || 0) *
          (Number(line.conversionRateAtTime) || 1);
        if (!quantity) continue;

        const movements: Array<{
          at: Date;
          storeId: string | null;
          sign: 1 | -1;
        }> = [];
        if (exportAt)
          movements.push({
            at: new Date(exportAt),
            storeId: transfer.fromStoreId,
            sign: -1,
          });
        if (importAt)
          movements.push({
            at: new Date(importAt),
            storeId: transfer.toStoreId,
            sign: 1,
          });

        // Hủy phiếu phải đảo lại đúng những giao dịch đã phát sinh trước đó.
        if (status === StoreTransferStatus.CANCELED && cancelAt) {
          if (exportAt)
            movements.push({
              at: new Date(cancelAt),
              storeId: transfer.fromStoreId,
              sign: 1,
            });
          if (importAt)
            movements.push({
              at: new Date(cancelAt),
              storeId: transfer.toStoreId,
              sign: -1,
            });
        }

        for (const movement of movements) {
          if (movement.storeId !== storeId || movement.at < fromDate) continue;
          events.push({
            occurredAt: movement.at,
            transfer,
            sign: movement.sign,
            refType: InventoryRefType.TRANSFER,
            refId: transfer.id,
            refCode: transfer.code,
            quantity,
          });
        }
      }
    }
    for (const internalExport of internalExports) {
      if (internalExport.occurredAt < fromDate) continue;
      for (const line of internalExport.lines || []) {
        if (line.productId !== productId || !line.quantity) continue;
        const quantity =
          Math.abs(Number(line.quantity) || 0) *
          (Number(line.conversionRateAtTime) || 1);
        if (!quantity) continue;
        events.push({
          occurredAt: internalExport.occurredAt,
          internalExport,
          sign: -1,
          refType: InventoryRefType.INTERNAL_EXPORT,
          refId: internalExport.id,
          refCode: internalExport.code,
          quantity,
        });
      }
    }
    for (const price of prices) {
      const at = price.createdAt;
      if (at >= fromDate) {
        events.push({
          occurredAt: at,
          price,
          refType: InventoryRefType.PRODUCT_PRICE_UPDATE,
          refId: price.id,
          refCode: price.code,
          quantity: 0,
        });
      }
    }
    return events.sort(
      (a, b) =>
        a.occurredAt.getTime() - b.occurredAt.getTime() ||
        Number(!!b.price) - Number(!!a.price) ||
        a.refId.localeCompare(b.refId),
    );
  }

  private orderRefType(type: OrderType): InventoryRefType {
    switch (type) {
      case OrderType.PURCHASE:
        return InventoryRefType.PURCHASE;
      case OrderType.SALE:
        return InventoryRefType.SALE;
      case OrderType.PURCHASE_RETURN:
        return InventoryRefType.PURCHASE_RETURN;
      default:
        return InventoryRefType.SALE_RETURN;
    }
  }

  private async previousState(
    productId: string,
    storeId: string,
    fromDate: Date,
    manager: EntityManager,
  ): Promise<State> {
    const previous = await this.transactionRepository
      .getRepository(manager)
      .findOne({
        where: {
          productId,
          storeId,
          occurredAt: LessThan(fromDate),
          deletedAt: IsNull(),
        } as any,
        order: { occurredAt: "DESC", createdAt: "DESC", id: "DESC" } as any,
      });
    if (previous)
      return {
        quantity: Number(previous.quantityAfter) || 0,
        value: Number(previous.inventoryValueAfter) || 0,
        cost: Number(previous.costPriceAfter) || 0,
      };
    return {
      quantity: 0,
      value: 0,
      cost: await this.costAt(productId, storeId, fromDate, manager),
    };
  }

  private async syncOrderCosts(
    orderIds: string[],
    manager: EntityManager,
  ): Promise<void> {
    for (const orderId of [...new Set(orderIds)]) {
      const order = await this.orderRepository.getRepository(manager).findOne({
        where: { id: orderId },
        relations: { lines: true, returnLines: true },
      });
      if (!order) continue;
      for (const line of [
        ...(order.lines || []),
        ...(order.returnLines || []),
      ]) {
        if (!line.productId) continue;
        const tx = await this.transactionRepository
          .getRepository(manager)
          .findOne({
            where: {
              refId: order.id,
              productId: line.productId,
              storeId: order.storeId,
            } as any,
            order: { occurredAt: "DESC", createdAt: "DESC" } as any,
          });
        if (!tx) continue;
        const quantity =
          Math.abs(Number(line.quantity) || 0) *
          (Number(line.conversionRateAtTime) || 1);
        await this.orderLineRepository.getRepository(manager).update(line.id, {
          costPriceAtTime: Number(tx.costPriceAfter) || 0,
          totalCost: quantity * (Number(tx.costPriceAfter) || 0),
        } as any);
      }
      const lines = await this.orderLineRepository.getRepository(manager).find({
        where: [{ orderId: order.id }, { returnOrderId: order.id }] as any,
      });
      const totalCost = lines.reduce(
        (sum, line) => sum + (Number(line.totalCost) || 0),
        0,
      );
      await this.orderRepository
        .getRepository(manager)
        .update(
          order.id,
          this.isReturn(order.type)
            ? { returnTotalCost: totalCost }
            : ({ totalCost } as any),
        );
    }
  }

  async recalculateProductStoreFromDate(
    productId: string,
    storeId: string,
    fromDate: Date,
    manager?: EntityManager,
  ): Promise<void> {
    const em = await this.managerOf(manager);
    await this.transactionRepository
      .getRepository(em)
      .createQueryBuilder()
      .delete()
      .where({ productId, storeId } as any)
      .andWhere('"occurredAt" >= :fromDate', { fromDate })
      .execute();
    const state = await this.previousState(productId, storeId, fromDate, em);
    const events = await this.loadEvents(productId, storeId, fromDate, em);
    const orderIds: string[] = [];
    for (const event of events) {
      const oldCost = state.cost;
      if (event.price) {
        state.cost = Number(event.price.costPrice) || 0;
        state.value = state.quantity * state.cost;
      } else {
        const signedQty = (event.sign || 1) * event.quantity;
        const amount = Math.abs(signedQty * state.cost);
        state.quantity += signedQty;
        state.value += (event.sign || 1) * amount;
        state.value = state.quantity * state.cost;
      }
      const tx = this.transactionRepository.getRepository(em).create({
        occurredAt: event.occurredAt,
        productId,
        storeId,
        quantity: event.price ? 0 : (event.sign || 1) * event.quantity,
        amount: event.price
          ? Math.abs(state.quantity * (state.cost - oldCost))
          : Math.abs((event.sign || 1) * event.quantity * state.cost),
        type: event.price
          ? state.cost >= oldCost
            ? TransactionType.IN
            : TransactionType.OUT
          : (event.sign || 1) > 0
            ? TransactionType.IN
            : TransactionType.OUT,
        costPriceAfter: state.cost,
        quantityAfter: state.quantity,
        inventoryValueAfter: state.value,
        refType: event.refType,
        refId: event.refId,
        refCode: event.refCode,
      });
      await this.transactionRepository.getRepository(em).save(tx);
      if (event.order) orderIds.push(event.order.id);
    }
    await this.syncOrderCosts(orderIds, em);
    await this.stockMetadata.updateStockMetadata(productId, em);
  }

  /** Số lượng tồn ngay trước một chứng từ, dùng để kiểm tra không xuất âm. */
  async getQuantityBefore(
    productId: string,
    storeId: string,
    occurredAt: Date | string,
    manager?: EntityManager,
    excludedRefId?: string,
  ): Promise<number> {
    const em = await this.managerOf(manager);
    const query = this.transactionRepository
      .getRepository(em)
      .createQueryBuilder("tx")
      .where('tx."productId" = :productId', { productId })
      .andWhere('tx."storeId" = :storeId', { storeId })
      .andWhere('tx."occurredAt" < :occurredAt', {
        occurredAt: new Date(occurredAt),
      })
      .andWhere('tx."deletedAt" IS NULL')
      .orderBy('tx."occurredAt"', "DESC")
      .addOrderBy('tx."createdAt"', "DESC")
      .addOrderBy('tx."id"', "DESC");

    if (excludedRefId)
      query.andWhere('tx."refId" <> :excludedRefId', { excludedRefId });
    const transaction = await query.getOne();
    return Number(transaction?.quantityAfter) || 0;
  }

  async getCostPriceBefore(
    productId: string,
    storeId: string,
    occurredAt: Date | string,
    manager?: EntityManager,
  ): Promise<number> {
    const em = await this.managerOf(manager);
    return this.costAt(productId, storeId, new Date(occurredAt), em);
  }

  async assertAvailable(
    productId: string,
    storeId: string,
    quantity: number,
    occurredAt: Date | string,
    manager?: EntityManager,
    excludedRefId?: string,
  ): Promise<void> {
    const available = await this.getQuantityBefore(
      productId,
      storeId,
      occurredAt,
      manager,
      excludedRefId,
    );
    if (available + 1e-9 < quantity) {
      const product = await this.productRepository.getSnapshot(productId, manager);
      throw new BadRequestError(
        `Tồn kho sản phẩm ${product?.code || product?.name || productId} không đủ: hiện có ${available}, cần ${quantity}.`,
      );
    }
  }

  async recalculateProductWarehouseFromDate(
    productId: string,
    warehouseId: string,
    fromDate: Date,
    manager?: EntityManager,
  ): Promise<void> {
    return this.recalculateProductStoreFromDate(
      productId,
      warehouseId,
      fromDate,
      manager,
    );
  }

  async recalculateFromDate(
    nodes: InventoryRecalculateNode[] | Date,
    manager?: EntityManager,
  ): Promise<void> {
    const em = await this.managerOf(manager);
    if (nodes instanceof Date) {
      const products = await this.productRepository.getRepository(em).find({
        where: { deletedAt: IsNull() } as any,
        relations: { storeProducts: true },
      });
      for (const product of products)
        for (const storeProduct of product.storeProducts || [])
          await this.recalculateProductStoreFromDate(
            product.id,
            storeProduct.storeId,
            nodes,
            em,
          );
      return;
    }
    for (const node of nodes)
      await this.recalculateProductStoreFromDate(
        node.productId,
        node.storeId,
        new Date(node.fromDate),
        em,
      );
  }

  async collectAffectedInventoryNodes(
    nodes: InventoryRecalculateNode[],
    _manager?: EntityManager,
  ): Promise<InventoryRecalculateNode[]> {
    const result = new Map<string, InventoryRecalculateNode>();
    for (const node of nodes || []) {
      const key = `${node.productId}:${node.storeId}`;
      const current = result.get(key);
      if (!current || new Date(node.fromDate) < new Date(current.fromDate))
        result.set(key, node);
    }
    return [...result.values()];
  }
}
