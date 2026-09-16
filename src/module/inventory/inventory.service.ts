import { inject, injectable } from "inversify";
import { In, IsNull } from "typeorm";
import { TransactionService } from "@/shared/base/TransactionService";
import { ApiResponse } from "@/shared/types/interfaces";
import {
  InventoryTransaction,
  InventoryRefType,
} from "@/database/models/store/InventoryTransaction";
import { TransactionType } from "@/shared/constants/enum";
import {
  GetStockReportQueryDto,
  GetTransactionDetailsQueryDto,
} from "./inventory.validator";
import { INVENTORY_TYPES } from "./inventory.types";
import { PRODUCT_TYPES } from "../product/product.types";
import { ProductRepository } from "../product/product.repository";
import { InventoryRepository } from "./inventory.repository";

type InventoryTransactionDetail = Omit<InventoryTransaction, "isDeleted"> & {
  closingQuantity: number;
  closingAmount: number;
  costPrice: number;
  runningCostPrice: number;
};

@injectable()
export class InventoryService extends TransactionService {
  constructor(
    @inject(PRODUCT_TYPES.ProductRepository)
    private productRepository: ProductRepository,
    @inject(INVENTORY_TYPES.InventoryRepository)
    private transactionRepository: InventoryRepository,
  ) {
    super();
  }
  async getStockReport(params: GetStockReportQueryDto, accessibleStoreIds?: string[]): Promise<ApiResponse> {
    const manager = await this.getManager();
    const startAt = params.startAt ? new Date(params.startAt) : new Date(0);
    const endAt = params.endAt ? new Date(params.endAt) : new Date();
    const productQb = this.productRepository
      .getRepository(manager)
      .createQueryBuilder("p")
      .where("p.deletedAt IS NULL");
    if (params.productIds?.length)
      productQb.andWhere("p.id IN (:...productIds)", {
        productIds: params.productIds,
      });
    if (params.keyword)
      productQb.andWhere("(p.code ILIKE :keyword OR p.name ILIKE :keyword)", {
        keyword: `%${params.keyword}%`,
      });
    const products = await productQb.getMany();
    const transactions = await this.transactionRepository
      .getRepository(manager)
      .find({
        where: { deletedAt: IsNull() } as any,
        order: { occurredAt: "ASC", createdAt: "ASC" } as any,
      });
    const requestedStores = params.storeIds?.length
      ? new Set(params.storeIds)
      : params.storeId
        ? new Set([params.storeId])
        : Array.isArray(accessibleStoreIds)
          ? new Set(accessibleStoreIds)
          : undefined;
    if (requestedStores && Array.isArray(accessibleStoreIds)) {
      for (const storeId of requestedStores) {
        if (!accessibleStoreIds.includes(storeId)) requestedStores.delete(storeId);
      }
    }
    const data = products.flatMap((product) => {
      const productTransactions = transactions.filter(
        (tx) =>
          tx.productId === product.id &&
          tx.occurredAt <= endAt &&
          (!requestedStores || requestedStores.has(tx.storeId)),
      );
      const stores = [...new Set(productTransactions.map((tx) => tx.storeId))];
      return stores.map((storeId) => {
        const rows = productTransactions.filter((tx) => tx.storeId === storeId);
        const opening = rows.filter((tx) => tx.occurredAt < startAt).at(-1);
        const period = rows.filter(
          (tx) => tx.occurredAt >= startAt && tx.occurredAt <= endAt,
        );
        const incoming = period.filter(
          (tx) =>
            tx.type === TransactionType.IN &&
            tx.refType !== InventoryRefType.PRODUCT_PRICE_UPDATE,
        );
        const outgoing = period.filter(
          (tx) =>
            tx.type === TransactionType.OUT &&
            tx.refType !== InventoryRefType.PRODUCT_PRICE_UPDATE,
        );
        const priceChanges = period.filter(
          (tx) => tx.refType === InventoryRefType.PRODUCT_PRICE_UPDATE,
        );
        return {
          ...product,
          storeId,
          openingQuantity: Number(opening?.quantityAfter) || 0,
          openingAmount: Number(opening?.inventoryValueAfter) || 0,
          inQuantity: incoming.reduce(
            (s, tx) => s + Math.abs(Number(tx.quantity) || 0),
            0,
          ),
          inAmount: incoming.reduce((s, tx) => s + (Number(tx.amount) || 0), 0),
          outQuantity: outgoing.reduce(
            (s, tx) => s + Math.abs(Number(tx.quantity) || 0),
            0,
          ),
          outAmount: outgoing.reduce(
            (s, tx) => s + (Number(tx.amount) || 0),
            0,
          ),
          priceAdjustmentAmount: priceChanges.reduce(
            (s, tx) =>
              s +
              (Number(tx.amount) || 0) *
                (tx.type === TransactionType.IN ? 1 : -1),
            0,
          ),
          closingQuantity: Number(rows.at(-1)?.quantityAfter) || 0,
          closingAmount: Number(rows.at(-1)?.inventoryValueAfter) || 0,
        };
      });
    });
    return {
      statusCode: 200,
      success: true,
      message: "OK",
      data,
      pagination: {
        currentPage: params.page || 1,
        size: params.size || data.length,
        totalRecords: data.length,
        totalPages: 1,
      },
    };
  }

  async getTransactionDetails(
    params: GetTransactionDetailsQueryDto,
    accessibleStoreIds?: string[],
  ): Promise<ApiResponse<InventoryTransactionDetail[]>> {
    const manager = await this.getManager();
    const page = Math.max(1, Number(params.page) || 1);
    const size = Math.max(1, Number(params.size) || 20);
    const startAt = params.startAt ? new Date(params.startAt) : new Date(0);
    const endAt = params.endAt ? new Date(params.endAt) : new Date();
    const requestedStoreIds = params.storeId
      ? [params.storeId]
      : params.storeIds?.length
        ? params.storeIds
        : accessibleStoreIds;
    const filteredStoreIds = Array.isArray(requestedStoreIds) && Array.isArray(accessibleStoreIds)
      ? requestedStoreIds.filter((storeId) => accessibleStoreIds.includes(storeId))
      : requestedStoreIds;
    (params as any).storeId = filteredStoreIds?.length === 1 ? filteredStoreIds[0] : undefined;
    (params as any).storeIds = filteredStoreIds;
    const rows = await this.transactionRepository.getRepository(manager).find({
      where: {
        productId: params.productId,
        ...(params.storeId
          ? { storeId: params.storeId }
          : Array.isArray(accessibleStoreIds)
            ? { storeId: In(accessibleStoreIds) }
          : Array.isArray(filteredStoreIds)
            ? { storeId: In(filteredStoreIds) }
            : {}),
        deletedAt: IsNull(),
      } as any,
      order: { occurredAt: "ASC", createdAt: "ASC", id: "ASC" } as any,
    });

    type Balance = { quantity: number; amount: number };
    const balances = new Map<string, Balance>();
    const getBalance = (storeId: string): Balance => {
      const current = balances.get(storeId);
      if (current) return current;
      const initial = { quantity: 0, amount: 0 };
      balances.set(storeId, initial);
      return initial;
    };
    const getTotalBalance = (): Balance =>
      [...balances.values()].reduce(
        (total, balance) => ({
          quantity: total.quantity + balance.quantity,
          amount: total.amount + balance.amount,
        }),
        { quantity: 0, amount: 0 },
      );
    const getCostPrice = (balance: Balance): number =>
      balance.quantity ? balance.amount / balance.quantity : 0;

    let openingBalance: Balance | undefined;
    let totalInQuantity = 0;
    let totalInAmount = 0;
    let totalOutQuantity = 0;
    let totalOutAmount = 0;
    const transactions: InventoryTransactionDetail[] = [];

    // Replay toàn bộ ledger trước khi lọc refType để số dư sau giao dịch
    // vẫn phản ánh đúng tất cả phát sinh trong kỳ.
    for (const tx of rows) {
      if (tx.occurredAt > endAt) continue;

      if (!openingBalance && tx.occurredAt >= startAt) {
        openingBalance = params.storeId
          ? { ...getBalance(params.storeId) }
          : getTotalBalance();
      }

      // Giữ cả giao dịch chuyển kho trong báo cáo tổng hệ thống để người dùng
      // theo dõi đầy đủ các mốc xuất/nhập; khi xem riêng chi nhánh vẫn lọc theo
      // storeId như bình thường.
      const balance = getBalance(tx.storeId);
      const quantity = Math.abs(Number(tx.quantity) || 0);
      const amount = Math.abs(Number(tx.amount) || 0);
      const isIncoming = tx.type === TransactionType.IN;
      balance.quantity += isIncoming ? quantity : -quantity;
      balance.amount += isIncoming ? amount : -amount;

      if (tx.occurredAt < startAt) continue;

      if (isIncoming) {
        totalInQuantity += quantity;
        totalInAmount += amount;
      } else {
        totalOutQuantity += quantity;
        totalOutAmount += amount;
      }

      const runningBalance = params.storeId ? balance : getTotalBalance();
      const runningCostPrice = getCostPrice(runningBalance);
      const detail: InventoryTransactionDetail = {
        ...tx,
        closingQuantity: runningBalance.quantity,
        closingAmount: runningBalance.amount,
        costPrice: runningCostPrice,
        runningCostPrice,
      };

      if (!params.refType || tx.refType === params.refType) {
        transactions.push(detail);
      }
    }

    if (!openingBalance) {
      openingBalance = params.storeId
        ? { ...getBalance(params.storeId) }
        : getTotalBalance();
    }

    const closingBalance = params.storeId
      ? getBalance(params.storeId)
      : getTotalBalance();
    const totalRecords = transactions.length;
    const totalPages = Math.ceil(totalRecords / size);
    const currentPage = totalPages ? Math.min(page, totalPages) : 1;
    const offset = (currentPage - 1) * size;

    return {
      statusCode: 200,
      success: true,
      message: "OK",
      data: transactions.slice(offset, offset + size),
      pagination: {
        currentPage,
        size,
        totalRecords,
        totalPages,
      },
      summary: {
        openingQuantity: openingBalance.quantity,
        openingAmount: openingBalance.amount,
        openingCostPrice: getCostPrice(openingBalance),
        totalInQuantity,
        totalInAmount,
        totalOutQuantity,
        totalOutAmount,
        closingQuantity: closingBalance.quantity,
        closingAmount: closingBalance.amount,
        closingCostPrice: getCostPrice(closingBalance),
      },
    };
  }
}
