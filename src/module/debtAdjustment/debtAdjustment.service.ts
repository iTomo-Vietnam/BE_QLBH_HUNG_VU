import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { DebtAdjustment } from "@/database/models/DebtAdjustment";
import { Partner, PartnerType } from "@/database/models/Partner";
import { Attribute, AttributeType } from "@/database/models/Attribute";
import { BaseService } from "@/shared/base/BaseService";
import { DebtSide, nullUuidMap } from "@/shared/constants/enum";
import { FilterItem, RequestContext } from "@/shared/types/interfaces";
import { PARTNER_TYPES } from "../partner/partner.types";
import { PartnerRepository } from "../partner/partner.repository";
import { DebtAdjustmentRepository } from "./debtAdjustment.repository";
import { DEBT_ADJUSTMENT_TYPES } from "./debtAdjustment.types";
import { DebtAdjustmentQuery } from "./debtAdjustment.validator";
@injectable()
export class DebtAdjustmentService extends BaseService<DebtAdjustment> {
  protected repository: DebtAdjustmentRepository;
  protected uniqueFields: (keyof DebtAdjustment)[] = ["code"];
  protected timeField: keyof DebtAdjustment = "occurredAt";
  protected searchableFields: (keyof DebtAdjustment)[] = ["code", "reason"];
  constructor(
    @inject(DEBT_ADJUSTMENT_TYPES.Repository)
    repository: DebtAdjustmentRepository,
    @inject(PARTNER_TYPES.PartnerRepository)
    private partnerRepository: PartnerRepository,
  ) {
    super();
    this.repository = repository;
  }
  async validateBeforeCreate(
    data: DeepPartial<DebtAdjustment>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    this.setDelta(data);
    await this.attachPartner(data, manager, data.side);
  }

  async validateBeforeUpdate(
    id: string,
    data: DeepPartial<DebtAdjustment>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    const current = await this.repository.findById(id, manager);
    if (!current) throw new Error("debtAdjustment.not_found");
    this.setDelta(data, current);
    if (data.partnerId !== undefined) {
      await this.attachPartner(data, manager, data.side || current.side);
    }
  }

  async getFilterItemsAndTotal(
    query: DebtAdjustmentQuery,
    req?: RequestContext,
  ): Promise<{
    totalReceivable: number;
    totalPayable: number;
    filterItems: FilterItem[];
  }> {
    const partnerIds = query.partnerIds || [];
    const qb = this.repository
      .getRepository()
      .createQueryBuilder("debtAdjustment")
      .leftJoin(
        Partner,
        "debtAdjustmentPartnerSummary",
        "debtAdjustmentPartnerSummary.id = debtAdjustment.partnerId AND debtAdjustmentPartnerSummary.deletedAt IS NULL",
      )
      .leftJoin(
        Attribute,
        "debtAdjustmentPartnerGroupSummary",
        "debtAdjustmentPartnerGroupSummary.id = debtAdjustmentPartnerSummary.groupId",
      )
      .select("debtAdjustment.side", "side")
      .addSelect("debtAdjustmentPartnerSummary.groupId", "partnerGroupId")
      .addSelect("debtAdjustmentPartnerGroupSummary.name", "partnerGroupName")
      .addSelect("COALESCE(SUM(debtAdjustment.deltaAmount), 0)", "total")
      .where("debtAdjustment.deletedAt IS NULL")
      .groupBy("debtAdjustment.side")
      .addGroupBy("debtAdjustmentPartnerSummary.groupId")
      .addGroupBy("debtAdjustmentPartnerGroupSummary.name");

    if (partnerIds.length) {
      qb.andWhere(
        "debtAdjustment.partnerId IN (:...debtAdjustmentSummaryPartnerIds)",
        {
          debtAdjustmentSummaryPartnerIds: partnerIds,
        },
      );
    }

    const addDateCondition = (key: string, operator: string, param: string) => {
      const rawValue = (query as Record<string, unknown>)[key];
      if (rawValue === undefined || rawValue === null || rawValue === "")
        return;
      const value =
        rawValue instanceof Date
          ? new Date(rawValue)
          : new Date(String(rawValue));
      if (Number.isNaN(value.getTime())) return;
      if (
        operator === "<=" &&
        typeof rawValue === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
      ) {
        value.setUTCHours(23, 59, 59, 999);
      }
      qb.andWhere(`debtAdjustment.occurredAt ${operator} :${param}`, {
        [param]: value,
      });
    };

    addDateCondition("startAt", ">=", "debtAdjustmentSummaryStartAt");
    addDateCondition("endAt", "<=", "debtAdjustmentSummaryEndAt");
    addDateCondition(
      "occurredAtGte",
      ">=",
      "debtAdjustmentSummaryOccurredAtGte",
    );
    addDateCondition(
      "occurredAtLte",
      "<=",
      "debtAdjustmentSummaryOccurredAtLte",
    );

    for (const suffix of ["Gte", "Gt", "Eq", "Lte", "Lt"] as const) {
      const value = (query as Record<string, unknown>)[`deltaAmount${suffix}`];
      if (value === undefined || value === null || value === "") continue;
      const operator = { Gte: ">=", Gt: ">", Eq: "=", Lte: "<=", Lt: "<" }[
        suffix
      ];
      qb.andWhere(
        `debtAdjustment.deltaAmount ${operator} :debtAdjustmentSummaryDelta${suffix}`,
        {
          [`debtAdjustmentSummaryDelta${suffix}`]: value,
        },
      );
    }

    const rows = await qb.getRawMany<{
      side: DebtSide;
      partnerGroupId: string | null;
      partnerGroupName: string | null;
      total: string;
    }>();
    const totals = { totalReceivable: 0, totalPayable: 0 };
    const filterItems = rows
      .map((row) => {
        const value = Number(row.total || 0);
        if (row.side === DebtSide.RECEIVABLE) totals.totalReceivable += value;
        if (row.side === DebtSide.PAYABLE) totals.totalPayable += value;
        return {
          id: row.partnerGroupId || nullUuidMap.partnerGroup,
          name: row.partnerGroupName || "Không xác định",
          type:
            row.side === DebtSide.RECEIVABLE
              ? AttributeType.CUSTOMER_GROUP
              : AttributeType.SUPPLIER_GROUP,
          value,
          side: row.side,
          partnerGroupId: row.partnerGroupId || nullUuidMap.partnerGroup,
        };
      })
      .filter((item) => item.value !== 0) as FilterItem[];

    return { ...totals, filterItems };
  }

  private setDelta(
    data: DeepPartial<DebtAdjustment>,
    current?: DebtAdjustment,
  ) {
    const expectedAmount = data.expectedAmount ?? current?.expectedAmount;
    const countedAmount = data.countedAmount ?? current?.countedAmount;
    if (expectedAmount == null || countedAmount == null) {
      throw new Error("debtAdjustment.amount.required");
    }
    data.deltaAmount = Number(countedAmount) - Number(expectedAmount);
  }

  private async attachPartner(
    data: DeepPartial<DebtAdjustment>,
    manager: EntityManager,
    side?: DebtSide,
  ): Promise<void> {
    data.partnerSnapshot = null;
    if (!data.partnerId) return;
    await this.partnerRepository.attachInfo(data, manager);
    if (!data.partnerSnapshot) throw new Error("partner.not_found");
    const expectedType =
      side === DebtSide.RECEIVABLE
        ? PartnerType.CUSTOMER
        : PartnerType.SUPPLIER;
    if ((data.partnerSnapshot as any).type !== expectedType) {
      throw new Error("debtAdjustment.partner_invalid");
    }
  }
}
