import { inject, injectable } from "inversify";
import { EntityManager } from "typeorm";
import {
  DebtRefType,
  DebtTransaction,
  IncomeExpense,
  IncomeExpenseStatus,
  IncomeExpenseType,
  Order,
  OrderStatus,
  OrderType,
  PartnerType,
} from "@/database/models";
import { DebtSide, TransactionType } from "@/shared/constants/enum";
import { TransactionService } from "@/shared/base/TransactionService";
import { PARTNER_TYPES } from "../partner/partner.types";
import { PartnerRepository } from "../partner/partner.repository";
import { DEBT_TRANSACTION_TYPES } from "../debtTransaction/debtTransaction.types";
import { DebtTransactionRepository } from "../debtTransaction/debtTransaction.repository";

/**
 * Tạo lại các bút toán công nợ từ chứng từ nguồn.
 *
 * DebtTransaction là sổ phát sinh bất biến: chỉ order/income-expense được
 * phép gọi service này để đồng bộ theo refType + refId.
 */
@injectable()
export class DebtRecalculateService extends TransactionService {
  constructor(
    @inject(DEBT_TRANSACTION_TYPES.Repository)
    private transactionRepository: DebtTransactionRepository,
    @inject(PARTNER_TYPES.PartnerRepository)
    private partnerRepository: PartnerRepository,
  ) {
    super();
  }

  async syncForOrder(
    order: Pick<
      Order,
      | "id"
      | "type"
      | "status"
      | "partnerId"
      | "shipperId"
      | "shippingFee"
      | "isFreeShipping"
      | "occurredAt"
      | "orderAt"
      | "code"
      | "totalAmount"
      | "returnTotalAmount"
    >,
    manager: EntityManager,
  ): Promise<void> {
    const orderRefType = this.getOrderRefType(order.type);
    if (!orderRefType) return;

    await this.removeForOrder(order, manager);

    if (
      order.status !== OrderStatus.COMPLETED ||
      !this.isSupportedOrderType(order.type)
    ) {
      return;
    }

    const isReturn =
      order.type === OrderType.PURCHASE_RETURN ||
      order.type === OrderType.SALE_RETURN;
    const isPurchase = this.isPurchaseOrderType(order.type);
    const occurredAt = order.occurredAt || order.orderAt || new Date();
    const refCode = order.code || null;

    const partnerAmount =
      Number(isReturn ? order.returnTotalAmount : order.totalAmount) || 0;
    if (order.partnerId && partnerAmount > 0) {
      await this.transactionRepository.create(
        {
          occurredAt,
          partnerId: order.partnerId,
          side: isPurchase ? DebtSide.PAYABLE : DebtSide.RECEIVABLE,
          type: isReturn ? TransactionType.OUT : TransactionType.IN,
          amount: partnerAmount,
          refType: orderRefType,
          refId: order.id,
          refCode,
          note: `Công nợ đơn ${order.code || order.id}`,
        },
        manager,
      );
    }

    const amount = Number(order.shippingFee || 0);
    if (!Number.isFinite(amount) || amount <= 0 || !order.shipperId) return;

    // Với đơn mua, chỉ khi doanh nghiệp chịu phí mới phát sinh nợ shipper.
    // Với đơn bán, shipper luôn là bên phải trả phí vận chuyển.
    const shouldCreateShippingDebt = isPurchase
      ? order.isFreeShipping === true
      : true;
    if (!shouldCreateShippingDebt) return;

    await this.transactionRepository.create(
      {
        occurredAt,
        partnerId: order.shipperId,
        side: DebtSide.PAYABLE,
        type: TransactionType.IN,
        amount,
        refType: DebtRefType.SHIPPING_FEE,
        refId: order.id,
        refCode,
        note: `Phí vận chuyển đơn ${order.code || order.id}`,
      },
      manager,
    );
  }

  async removeForOrder(
    order: Pick<Order, "id" | "type">,
    manager?: EntityManager,
  ): Promise<void> {
    const orderRefType = this.getOrderRefType(order.type);
    if (orderRefType) {
      await this.removeByReference(orderRefType, order.id, manager);
    }
    await this.removeByReference(DebtRefType.SHIPPING_FEE, order.id, manager);
  }

  async syncForIncomeExpense(
    item: Pick<
      IncomeExpense,
      | "id"
      | "type"
      | "status"
      | "partnerId"
      | "amount"
      | "occurredAt"
      | "code"
    >,
    manager: EntityManager,
  ): Promise<void> {
    const refType =
      item.type === IncomeExpenseType.INCOME
        ? DebtRefType.INCOME
        : DebtRefType.EXPENSE;

    await this.removeIncomeExpenseReferences(item.id, manager);

    if (item.status !== IncomeExpenseStatus.COMPLETED) return;
    if (!item.partnerId || Number(item.amount || 0) <= 0) return;

    const partner = await this.partnerRepository
      .getRepository(manager)
      .findOne({ where: { id: item.partnerId, deletedAt: null } as any });
    if (!partner) return;

    const side =
      partner.type === PartnerType.CUSTOMER
        ? DebtSide.RECEIVABLE
        : partner.type === PartnerType.SUPPLIER ||
            partner.type === PartnerType.SHIPPER
          ? DebtSide.PAYABLE
          : null;
    if (!side) return;

    await this.transactionRepository.create(
      {
        occurredAt: item.occurredAt,
        partnerId: item.partnerId,
        side,
        // Thu tiền/chi tiền đều làm giảm số nợ đang theo dõi.
        type: TransactionType.OUT,
        amount: Number(item.amount),
        refType,
        refId: item.id,
        refCode: item.code || null,
        note: `Thu chi ${item.code || item.id}`,
      },
      manager,
    );
  }

  async removeIncomeExpenseReferences(
    id: string,
    manager?: EntityManager,
  ): Promise<void> {
    await Promise.all([
      this.removeByReference(DebtRefType.INCOME, id, manager),
      this.removeByReference(DebtRefType.EXPENSE, id, manager),
    ]);
  }

  async removeByReference(
    refType: DebtRefType,
    refId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.transactionRepository.removeByReference(refType, refId, manager);
  }

  private isPurchaseOrderType(type: OrderType): boolean {
    return (
      type === OrderType.PURCHASE || type === OrderType.PURCHASE_RETURN
    );
  }

  private isSupportedOrderType(type: OrderType): boolean {
    return [
      OrderType.PURCHASE,
      OrderType.SALE,
      OrderType.PURCHASE_RETURN,
      OrderType.SALE_RETURN,
    ].includes(type);
  }

  private getOrderRefType(type: OrderType): DebtRefType | null {
    switch (type) {
      case OrderType.PURCHASE:
        return DebtRefType.PURCHASE;
      case OrderType.SALE:
        return DebtRefType.SALE;
      case OrderType.PURCHASE_RETURN:
        return DebtRefType.PURCHASE_RETURN;
      case OrderType.SALE_RETURN:
        return DebtRefType.SALE_RETURN;
      default:
        return null;
    }
  }
}

