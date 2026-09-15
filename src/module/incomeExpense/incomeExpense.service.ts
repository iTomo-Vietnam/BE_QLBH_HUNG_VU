import { inject, injectable } from "inversify";
import {
  DeepPartial,
  EntityManager,
  In,
  IsNull,
  LessThanOrEqual,
} from "typeorm";
import {
  IncomeExpense,
  IncomeExpenseStatus,
  IncomeExpenseType,
} from "@/database/models/store/IncomeExpense";
import { Order, OrderStatus } from "@/database/models/store/Order";
import { BaseService } from "@/shared/base/BaseService";
import { RequestContext } from "@/shared/types/interfaces";
import { FUND_TYPES } from "../fund/fund.types";
import { FundRepository } from "../fund/fund.repository";
import { PARTNER_TYPES } from "../partner/partner.types";
import { PartnerRepository } from "../partner/partner.repository";
import { ATTRIBUTE_TYPES } from "../attribute/attribute.types";
import { AttributeRepository } from "../attribute/attribute.repository";
import { IncomeExpenseRepository } from "./incomeExpense.repository";
import { INCOME_EXPENSE_TYPES } from "./incomeExpense.types";
import { DEBT_TYPES } from "../debt/debt.types";
import { DebtRecalculateService } from "../debt/debt.recalculate.service";
import { AttributeType } from "@/database/models/Attribute";
import { FilterItem } from "@/shared/types/interfaces";
import { IncomeExpenseQueryDto } from "./incomeExpense.validator";
import { nullUuidMap } from "@/shared/constants/enum";
import { TRANSFER_NOTE_TYPES } from "../transferNote/transferNote.types";
import { TransferNoteService } from "../transferNote/transferNote.service";
@injectable()
export class IncomeExpenseService extends BaseService<IncomeExpense> {
  protected repository: IncomeExpenseRepository;
  protected uniqueFields: (keyof IncomeExpense)[] = ["code"];
  protected uniqueScope: (keyof IncomeExpense)[] = ["storeId"];
  protected searchableFields = ["code", "description"];
  protected timeField: keyof IncomeExpense = "occurredAt";
  constructor(
    @inject(INCOME_EXPENSE_TYPES.Repository)
    repository: IncomeExpenseRepository,
    @inject(FUND_TYPES.Repository) private fundRepository: FundRepository,
    @inject(PARTNER_TYPES.PartnerRepository)
    private partnerRepository: PartnerRepository,
    @inject(ATTRIBUTE_TYPES.AttributeRepository)
    private attributeRepository: AttributeRepository,
    @inject(DEBT_TYPES.DebtRecalculateService)
    private debtService: DebtRecalculateService,
    @inject(TRANSFER_NOTE_TYPES.Service)
    private transferNoteService: TransferNoteService,
  ) {
    super();
    this.repository = repository;
  }

  protected async attachActions(
    entity: IncomeExpense & { _actions?: any },
  ): Promise<void> {
    entity._actions = {
      ...this.getDefaultAction(),
      delete: { can: !entity.orderId },
    };
  }

  async validateBeforeCreate(
    data: DeepPartial<IncomeExpense>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    data.storeId = data.storeId || req?.storeContext?.storeId;
    if (!data.storeId) throw new Error("store.required");
    if (!data.type) throw new Error("incomeExpense.type.required");
    if (
      ![IncomeExpenseType.INCOME, IncomeExpenseType.EXPENSE].includes(data.type)
    )
      throw new Error("incomeExpense.type.invalid");
    data.occurredAt = data.occurredAt || new Date();
    if (data.orderId) {
      const order = await manager.getRepository(Order).findOne({
        where: { id: data.orderId, deletedAt: null } as any,
      });
      if (!order) throw new Error("order.not_found");
      data.status = this.getStatusForOrder(order.status);
    } else {
      data.status = IncomeExpenseStatus.COMPLETED;
    }
    await this.fundRepository.attachInfo(data, manager);
    await this.partnerRepository.attachInfo(data, manager);
    if (data.categoryId) {
      await this.attributeRepository.attachInfo(data as any, manager);
      if (!data.categorySnapshot) throw new Error("category.not_found");
    }
  }

  async validateBeforeUpdate(
    id: string,
    data: DeepPartial<IncomeExpense>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    const current = await this.getById(id, req, manager);

    if (data.orderId !== undefined && data.orderId !== current.orderId) {
      throw new Error("incomeExpense.order_locked");
    }
    if (current.orderId) {
      this.assertOrderLinkedFieldsUnchanged(current, data);
      if (data.type !== undefined && data.type !== current.type) {
        throw new Error("incomeExpense.order_type_locked");
      }
      if (data.status !== undefined && data.status !== current.status) {
        throw new Error("incomeExpense.order_status_locked");
      }
    } else if (data.status !== undefined) {
      throw new Error("incomeExpense.status_managed");
    }

    if (data.fundId !== undefined) {
      await this.fundRepository.attachInfo(data, manager);
    }
    if (data.partnerId !== undefined) {
      await this.partnerRepository.attachInfo(data, manager);
    }
    if (data.categoryId !== undefined) {
      data.categorySnapshot = null;
      if (data.categoryId) {
        await this.attributeRepository.attachInfo(data as any, manager);
        if (!data.categorySnapshot) throw new Error("category.not_found");
      }
    }
  }

  async validateBeforeDelete(data: IncomeExpense): Promise<void> {
    if (data.orderId) throw new Error("incomeExpense.order_delete_forbidden");
  }

  async actionAfterCreate(
    data: IncomeExpense,
    manager: EntityManager,
  ): Promise<void> {
    await this.debtService.syncForIncomeExpense(data, manager);
    await this.transferNoteService.revalidateByReferenceCode(
      data.storeId,
      data.code,
      manager,
    );
  }

  async actionAfterUpdate(
    data: IncomeExpense,
    manager: EntityManager,
    _req?: RequestContext,
    inputData?: DeepPartial<IncomeExpense>,
  ): Promise<void> {
    await this.debtService.syncForIncomeExpense(data, manager);
    await this.transferNoteService.revalidateByReferenceCode(
      data.storeId,
      data.code,
      manager,
    );
    if (inputData?.code && inputData.code !== data.code) {
      await this.transferNoteService.revalidateByReferenceCode(
        data.storeId,
        inputData.code,
        manager,
      );
    }
  }

  async actionAfterDelete(
    data: IncomeExpense,
    manager: EntityManager,
  ): Promise<void> {
    await this.debtService.removeIncomeExpenseReferences(data.id, manager);
    await this.transferNoteService.revalidateByReferenceCode(
      data.storeId,
      data.code,
      manager,
    );
  }

  /** Hủy các phiếu thu/chi nháp do scheduler xử lý sau giờ làm việc. */
  async cancelDraftsForSystem(
    storeId: string,
    createdBefore: Date,
  ): Promise<number> {
    const repository = this.repository.getRepository();
    const drafts = await repository.find({
      where: {
        storeId,
        status: IncomeExpenseStatus.DRAFT,
        createdAt: LessThanOrEqual(createdBefore),
        deletedAt: IsNull(),
      } as any,
    });
    if (!drafts.length) return 0;

    await repository
      .createQueryBuilder()
      .update(IncomeExpense)
      .set({ status: IncomeExpenseStatus.CANCELED })
      .where("storeId = :storeId", { storeId })
      .andWhere("status = :status", { status: IncomeExpenseStatus.DRAFT })
      .andWhere('"createdAt" <= :createdBefore', { createdBefore })
      .andWhere('"deletedAt" IS NULL')
      .execute();

    for (const item of drafts) {
      await this.debtService.removeIncomeExpenseReferences(item.id);
    }
    return drafts.length;
  }

  async getFilterItemsAndTotal(
    query: IncomeExpenseQueryDto,
    req?: RequestContext,
  ): Promise<{
    totalIncome: number;
    totalExpense: number;
    filterItems: FilterItem[];
  }> {
    const storeId = req?.storeContext?.storeId || query.storeId;
    const fundIds = query.fundIds?.length
      ? query.fundIds
      : query.fundId
        ? [query.fundId]
        : [];
    const partnerIds = query.partnerIds?.length
      ? query.partnerIds
      : query.partnerId
        ? [query.partnerId]
        : [];
    const orderIds = query.orderIds?.length
      ? query.orderIds
      : query.orderId
        ? [query.orderId]
        : [];
    const status = query.status || IncomeExpenseStatus.COMPLETED;
    const qb = this.repository
      .getRepository()
      .createQueryBuilder("incomeExpense")
      .select("incomeExpense.categoryId", "categoryId")
      .addSelect("incomeExpense.type", "type")
      .addSelect("COALESCE(SUM(incomeExpense.amount), 0)", "total")
      .where("incomeExpense.deletedAt IS NULL")
      .andWhere("incomeExpense.status = :summaryStatus", {
        summaryStatus: status,
      })
      .groupBy("incomeExpense.categoryId")
      .addGroupBy("incomeExpense.type");

    if (storeId)
      qb.andWhere("incomeExpense.storeId = :summaryStoreId", {
        summaryStoreId: storeId,
      });
    if (fundIds.length)
      qb.andWhere("incomeExpense.fundId IN (:...summaryFundIds)", {
        summaryFundIds: fundIds,
      });
    if (partnerIds.length) {
      qb.andWhere("incomeExpense.partnerId IN (:...summaryPartnerIds)", {
        summaryPartnerIds: partnerIds,
      });
    }
    if (orderIds.length)
      qb.andWhere("incomeExpense.orderId IN (:...summaryOrderIds)", {
        summaryOrderIds: orderIds,
      });
    if (query.startAt)
      qb.andWhere("incomeExpense.occurredAt >= :summaryStartAt", {
        summaryStartAt: query.startAt,
      });
    if (query.endAt)
      qb.andWhere("incomeExpense.occurredAt <= :summaryEndAt", {
        summaryEndAt: query.endAt,
      });

    for (const suffix of ["Gte", "Gt", "Eq", "Lte", "Lt"] as const) {
      const value = (query as Record<string, unknown>)[`amount${suffix}`];
      if (value === undefined || value === null || value === "") continue;
      const operator = { Gte: ">=", Gt: ">", Eq: "=", Lte: "<=", Lt: "<" }[
        suffix
      ];
      qb.andWhere(`incomeExpense.amount ${operator} :summaryAmount${suffix}`, {
        [`summaryAmount${suffix}`]: value,
      });
    }

    const [categories, rows] = await Promise.all([
      this.attributeRepository.findByOptions({
        where: {
          type: In([
            AttributeType.INCOME_CATEGORY,
            AttributeType.EXPENSE_CATEGORY,
          ]),
          deletedAt: IsNull(),
        } as any,
        select: { id: true, name: true, type: true } as any,
        order: { name: "ASC" } as any,
      }),
      qb.getRawMany<{
        categoryId: string | null;
        type: IncomeExpenseType;
        total: string;
      }>(),
    ]);

    const totals = { totalIncome: 0, totalExpense: 0 };
    const amountByCategory = new Map<string, number>();
    for (const row of rows) {
      const amount = Number(row.total || 0);
      if (row.type === IncomeExpenseType.INCOME) totals.totalIncome += amount;
      if (row.type === IncomeExpenseType.EXPENSE) totals.totalExpense += amount;
      amountByCategory.set(`${row.categoryId || "null"}:${row.type}`, amount);
    }

    const filterItems = categories
      .map((category) => ({
        id: category.id,
        name: category.name,
        type: category.type,
        value:
          amountByCategory.get(
            `${category.id}:${category.type === AttributeType.INCOME_CATEGORY ? IncomeExpenseType.INCOME : IncomeExpenseType.EXPENSE}`,
          ) || 0,
      }))
      .filter((item) => item.value > 0);

    filterItems.push(
      {
        id: nullUuidMap.incomeCategory,
        name: "Thu không xác định",
        type: AttributeType.INCOME_CATEGORY,
        value: amountByCategory.get(`null:${IncomeExpenseType.INCOME}`) || 0,
      },
      {
        id: nullUuidMap.expenseCategory,
        name: "Chi không xác định",
        type: AttributeType.EXPENSE_CATEGORY,
        value: amountByCategory.get(`null:${IncomeExpenseType.EXPENSE}`) || 0,
      },
    );

    return { ...totals, filterItems };
  }

  private getStatusForOrder(status: OrderStatus): IncomeExpenseStatus {
    if (status === OrderStatus.COMPLETED) return IncomeExpenseStatus.COMPLETED;
    if (status === OrderStatus.CANCELED) return IncomeExpenseStatus.CANCELED;
    return IncomeExpenseStatus.DRAFT;
  }

  private assertOrderLinkedFieldsUnchanged(
    current: IncomeExpense,
    data: DeepPartial<IncomeExpense>,
  ): void {
    if (
      data.partnerId !== undefined &&
      (data.partnerId || null) !== (current.partnerId || null)
    ) {
      throw new Error("incomeExpense.order_partner_locked");
    }
    if (
      data.categoryId !== undefined &&
      (data.categoryId || null) !== (current.categoryId || null)
    ) {
      throw new Error("incomeExpense.order_category_locked");
    }
    if (
      data.description !== undefined &&
      (data.description || null) !== (current.description || null)
    ) {
      throw new Error("incomeExpense.order_description_locked");
    }
    if (data.occurredAt !== undefined) {
      const currentTime =
        current.occurredAt?.getTime?.() ??
        new Date(current.occurredAt).getTime();
      const nextTime = new Date(data.occurredAt as Date).getTime();
      if (currentTime !== nextTime) {
        throw new Error("incomeExpense.order_occurred_at_locked");
      }
    }
  }
}
