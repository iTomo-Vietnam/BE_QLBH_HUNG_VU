import {
  Brackets,
  DeepPartial,
  EntityManager,
  SelectQueryBuilder,
} from "typeorm";
import { injectable } from "inversify";
import {
  BaseRepository,
  IFindPaginationOptions,
} from "@/shared/base/BaseRepository";
import { Partner, PartnerSnapshot } from "@/database/models";
import {
  PartnerSelectFull,
  PartnerSelectList,
  PartnerRelations,
  PartnerRelationsList,
} from "./partner.select";
import { PartnerQueryDto } from "./partner.validator";

/**
 * Partner Repository - Tenant Entity
 * Sử dụng BaseRepository để truy vấn trên tenant schemas
 */
@injectable()
export class PartnerRepository extends BaseRepository<Partner> {
  protected entityClass = Partner;
  protected selectedFields = PartnerSelectFull;
  protected selectedFieldsForList = PartnerSelectList;
  protected relations = PartnerRelations;
  protected relationsForList = PartnerRelationsList;
  protected addressFields = ["address"];

  private getLastTransactionAtExpression(alias: string): string {
    return `(SELECT MAX("debtTransaction"."occurredAt")
      FROM "debt_transactions" "debtTransaction"
      WHERE "debtTransaction"."partnerId" = ${alias}.id
        AND "debtTransaction"."deletedAt" IS NULL)`;
  }

  private getCurrentDebtExpression(
    alias: string,
    hasOffsetAt: boolean,
  ): string {
    const transactionDateFilter = hasOffsetAt
      ? `AND "debtTransaction"."occurredAt" <= :partnerDebtOffsetAt`
      : "";
    const adjustmentDateFilter = hasOffsetAt
      ? `AND "debtAdjustment"."occurredAt" <= :partnerDebtOffsetAt`
      : "";
    const debtSideCondition = `((${alias}.type = 'customer' AND "debtTransaction"."side" = 'receivable')
      OR (${alias}.type <> 'customer' AND "debtTransaction"."side" = 'payable'))`;
    const adjustmentSideCondition = `((${alias}.type = 'customer' AND "debtAdjustment"."side" = 'receivable')
      OR (${alias}.type <> 'customer' AND "debtAdjustment"."side" = 'payable'))`;

    const transactionAmount = `(SELECT COALESCE(SUM(
      CASE WHEN "debtTransaction"."type" = 'in'
        THEN "debtTransaction"."amount"
        ELSE -"debtTransaction"."amount"
      END), 0)
      FROM "debt_transactions" "debtTransaction"
      WHERE "debtTransaction"."partnerId" = ${alias}.id
        AND ${debtSideCondition}
        AND "debtTransaction"."deletedAt" IS NULL
        ${transactionDateFilter})`;
    const adjustmentAmount = `(SELECT COALESCE(SUM("debtAdjustment"."deltaAmount"), 0)
      FROM "debt_adjustments" "debtAdjustment"
      WHERE "debtAdjustment"."partnerId" = ${alias}.id
        AND ${adjustmentSideCondition}
        AND "debtAdjustment"."deletedAt" IS NULL
        ${adjustmentDateFilter})`;

    return `(${transactionAmount} + ${adjustmentAmount})`;
  }

  protected mapRawEntities(rawAndEntities: {
    entities: Partner[];
    raw: any[];
  }): Partner[] {
    const entities = super.mapRawEntities(rawAndEntities) as Partner[];

    return entities.map((entity, index) => {
      const raw = rawAndEntities.raw[index] || {};
      const getRawValue = (fieldName: string) =>
        Object.entries(raw).find(([key]) =>
          key.toLowerCase().endsWith(fieldName.toLowerCase()),
        )?.[1];

      const lastTransactionAt = getRawValue("lasttransactionat");
      const currentDebtAmount = getRawValue("currentdebtamount");
      const cleanEntity = { ...entity } as Partner & Record<string, unknown>;

      Object.keys(cleanEntity).forEach((key) => {
        if (/^total(lastTransactionAt|currentDebtAmount)$/i.test(key)) {
          delete cleanEntity[key];
        }
      });

      if (lastTransactionAt !== undefined) {
        cleanEntity.lastTransactionAt = lastTransactionAt
          ? new Date(String(lastTransactionAt))
          : null;
      }
      if (currentDebtAmount !== undefined) {
        cleanEntity.currentDebtAmount = Number(currentDebtAmount) || 0;
      }

      return cleanEntity;
    });
  }

  protected async extendQueryBuilder(
    qb: SelectQueryBuilder<Partner>,
    options: IFindPaginationOptions<Partner>,
  ): Promise<void> {
    const alias = qb.alias;
    const {
      isOrganization,
      gender,
      sortBy,
      sortOrder,
      offsetAt,

      supplierGroupId,
      supplierGroupIds,
      customerGroupId,
      customerGroupIds,
      shipperGroupId,
      shipperGroupIds,
    } = (options.moreQuery as PartnerQueryDto) || {};

    const groupId = supplierGroupId || customerGroupId || shipperGroupId;

    const groupIds = [
      ...(supplierGroupIds || []),
      ...(customerGroupIds || []),
      ...(shipperGroupIds || []),
    ];

    if (groupId) {
      qb.andWhere(`${alias}.groupId = :groupId`, { groupId });
    } else if (this.checkArrayFilter(groupIds)) {
      qb.andWhere(`${alias}.groupId IN (:...groupIds)`, {
        groupIds,
      });
    }

    if (isOrganization !== undefined) {
      qb.andWhere(`${alias}.isOrganization = :isOrganization`, {
        isOrganization,
      });
    }

    if (this.checkArrayFilter(gender)) {
      qb.andWhere(`${alias}.gender IN (:...partnerGenders)`, {
        partnerGenders: gender,
      });
    }

    const hasOffsetAt = Boolean(offsetAt);
    const lastTransactionAtExpression =
      this.getLastTransactionAtExpression(alias);
    const currentDebtExpression = this.getCurrentDebtExpression(
      alias,
      hasOffsetAt,
    );

    qb.addSelect(
      lastTransactionAtExpression,
      "entity_totalLastTransactionAt",
    );
    qb.addSelect(currentDebtExpression, "entity_totalCurrentDebtAmount");

    if (offsetAt) {
      qb.setParameter("partnerDebtOffsetAt", new Date(offsetAt));
    }

    const source = (options.moreQuery || options) as Record<string, any>;
    const computedRanges = [
      {
        field: "lastTransactionAt",
        expression: lastTransactionAtExpression,
        date: true,
      },
      {
        field: "currentDebtAmount",
        expression: currentDebtExpression,
        date: false,
      },
    ];
    const operators: Record<string, string> = {
      Gte: ">=",
      Lte: "<=",
      Gt: ">",
      Lt: "<",
      Eq: "=",
    };

    for (const range of computedRanges) {
      for (const suffix of ["Gte", "Lte", "Gt", "Lt", "Eq"]) {
        const value = source[`${range.field}${suffix}`];
        if (value == null || value === "") continue;
        if (range.date && !["Gte", "Lte"].includes(suffix)) continue;

        const parameterName = `partner_${range.field}_${suffix}`;
        let normalizedValue: Date | number;
        if (range.date) {
          normalizedValue = new Date(value as string | number | Date);
          if (Number.isNaN(normalizedValue.getTime())) continue;
        } else {
          normalizedValue = Number(value);
          if (!Number.isFinite(normalizedValue)) continue;
        }

        qb.andWhere(
          `${range.expression} ${operators[suffix]} :${parameterName}`,
          { [parameterName]: normalizedValue },
        );
      }
    }

    if (
      sortBy === "lastTransactionAt" ||
      sortBy === "currentDebtAmount"
    ) {
      if (sortBy === "lastTransactionAt") {
        qb.orderBy(lastTransactionAtExpression, sortOrder || "DESC", "NULLS LAST");
      } else {
        qb.orderBy(currentDebtExpression, sortOrder || "DESC");
      }
    }
  }

  async getSnapshot(
    id: string,
    manager?: EntityManager,
  ): Promise<PartnerSnapshot | null> {
    const partner = await this.getRepository(manager).findOne({
      where: { id, deletedAt: null } as any,
    });
    return partner
      ? {
          id: partner.id,
          name: partner.name,
          code: partner.code,
          type: partner.type,
          address: partner.address,
          email: partner.email,
          phone: partner.phone,
          representative: partner.representative,
          banks: partner.banks,
          groupId: partner.groupId,
          isOrganization: partner.isOrganization,
          taxCode: partner.taxCode,
          identityCode: partner.identityCode,
          gender: partner.gender,
          dob: partner.dob,
        }
      : null;
  }

  async attachInfo<
    T extends {
      supplierId?: string | null;
      supplierSnapshot?: DeepPartial<PartnerSnapshot> | null;
      customerId?: string | null;
      customerSnapshot?: DeepPartial<PartnerSnapshot> | null;
      shipperId?: string | null;
      shipperSnapshot?: DeepPartial<PartnerSnapshot> | null;
      partnerId?: string | null;
      partnerSnapshot?: DeepPartial<PartnerSnapshot> | null;
    },
  >(data: T, manager?: EntityManager): Promise<void> {
    for (const [idKey, snapshotKey] of [
      ["supplierId", "supplierSnapshot"],
      ["customerId", "customerSnapshot"],
      ["shipperId", "shipperSnapshot"],
      ["partnerId", "partnerSnapshot"],
    ] as const) {
      const id = data[idKey];
      const snapshot = data[snapshotKey];
      if (id && (!snapshot || snapshot.id !== id))
        (data as any)[snapshotKey] = await this.getSnapshot(id, manager);
    }
  }
}

