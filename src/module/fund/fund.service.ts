import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager, IsNull } from "typeorm";
import { Fund, FundType } from "@/database/models/Fund";
import { FundAdjustment } from "@/database/models/FundAdjustment";
import { BaseService } from "@/shared/base/BaseService";
import { BadRequestError } from "@/shared/types/errors";
import { ActionMap, RequestContext } from "@/shared/types/interfaces";
import { generateCode } from "@/shared/utils/code.utils";
import { FundRepository } from "./fund.repository";
import { FUND_TYPES } from "./fund.types";
import { FUND_TRANSACTION_TYPES } from "../fundTransaction/fundTransaction.types";
import { FundTransactionService } from "../fundTransaction/fundTransaction.service";

/**
 * Bổ sung quỹ tiền mặt mặc định cho một cửa hàng.
 *
 * Hàm này dùng được cả trong service tạo cửa hàng và seeder để backfill các
 * cửa hàng cũ. Nếu cửa hàng đã có quỹ tiền mặt thì giữ lại quỹ hiện có và chỉ
 * đặt nó làm mặc định khi chưa có quỹ mặc định nào.
 */
export async function ensureDefaultCashFund(
  storeId: string,
  storeCode: string,
  manager: EntityManager,
): Promise<Fund> {
  const repository = manager.getRepository(Fund);
  const cashFunds = await repository.find({
    where: {
      storeId,
      type: FundType.CASH,
      deletedAt: IsNull(),
    } as any,
    order: { isDefault: "DESC", createdAt: "ASC" },
  });

  const existing = cashFunds[0];
  if (existing) {
    if (!existing.isDefault) {
      await repository.update(existing.id, { isDefault: true });
      existing.isDefault = true;
    }
    return existing;
  }

  const normalizedStoreCode = storeCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 21);
  const preferredCode = normalizedStoreCode
    ? `TM-${normalizedStoreCode}`
    : await generateCode("fund", storeId);
  const codeConflict = await repository.findOne({
    where: { code: preferredCode, storeId, deletedAt: IsNull() } as any,
  });
  const code = codeConflict
    ? await generateCode("fund", storeId)
    : preferredCode;

  return repository.save(
    repository.create({
      code,
      name: "Tiền mặt",
      type: FundType.CASH,
      storeId,
      isPersonal: false,
      isDefault: true,
      isActive: true,
    }),
  );
}

@injectable()
export class FundService extends BaseService<Fund> {
  protected repository: FundRepository;
  protected uniqueFields: (keyof Fund)[] = ["code"];
  protected uniqueScope: (keyof Fund)[] = ["storeId"];
  protected searchableFields = ["code", "name"];
  constructor(
    @inject(FUND_TYPES.Repository) repository: FundRepository,
    @inject(FUND_TRANSACTION_TYPES.Service)
    private fundTransactionService: FundTransactionService,
  ) {
    super();
    this.repository = repository;
  }
  async validateBeforeCreate(
    data: DeepPartial<Fund>,
    _manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    if (!data.type) throw new BadRequestError("fund.type.required");
    if (![FundType.CASH, FundType.BANK].includes(data.type)) {
      throw new BadRequestError("fund.type.invalid");
    }

    const hasStoreId = Object.prototype.hasOwnProperty.call(data, "storeId");
    if (!hasStoreId) data.storeId = req?.storeContext?.storeId ?? null;

    // Tiền mặt luôn là tài khoản công ty; chỉ tài khoản ngân hàng mới có thể
    // được đánh dấu là tài khoản cá nhân.
    if (data.type === FundType.CASH) data.isPersonal = false;
    else data.isPersonal = Boolean(data.isPersonal);
    if (data.isPersonal && !data.storeId) {
      throw new BadRequestError("Tài khoản cá nhân phải thuộc một cửa hàng");
    }

    // initialBalance chỉ dùng ở bước tạo mới; actionAfterCreate sẽ ghi nhận
    // thành một phiếu điều chỉnh đầu kỳ sau khi đã có fund.id.
    delete data.initialBalance;
    // isDefault chỉ được thiết lập bởi seed/backfill cho quỹ tiền mặt mặc định.
    // Không cho phép API tạo mới tự gán hoặc thay đổi trạng thái này.
    delete data.isDefault;

    if (!data.code) {
      data.code = await generateCode("fund", data.storeId ?? undefined);
    }

  }

  async validateBeforeUpdate(
    id: string,
    data: DeepPartial<Fund>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    const existing = await this.getById(id, req, manager);
    if (existing.isDefault) {
      throw new BadRequestError("fund.default.immutable");
    }

    delete data.isDefault;

    if (data.type && data.type !== existing.type) {
      throw new BadRequestError("fund.type.immutable");
    }

    const nextType = data.type ?? existing.type;
    const hasStoreId = Object.prototype.hasOwnProperty.call(data, "storeId");
    const nextStoreId = hasStoreId ? data.storeId : existing.storeId;
    const nextIsPersonal = data.isPersonal ?? existing.isPersonal;

    if (
      hasStoreId &&
      nextStoreId &&
      req?.storeContext?.storeId &&
      nextStoreId !== req.storeContext.storeId &&
      !req.userContext?.isAdmin
    ) {
      throw new BadRequestError("Chỉ được gắn quỹ với cửa hàng đang thao tác");
    }

    if (nextType === FundType.CASH) data.isPersonal = false;
    else if (nextIsPersonal && !nextStoreId) {
      throw new BadRequestError("Tài khoản cá nhân phải thuộc một cửa hàng");
    }
    if (
      existing.type === FundType.CASH &&
      hasStoreId &&
      nextStoreId !== existing.storeId
    ) {
      throw new BadRequestError("fund.cash.scope.immutable");
    }
  }

  async validateBeforeDelete(
    data: Fund,
    _manager: EntityManager,
    _req?: RequestContext,
  ): Promise<void> {
    if (data.isDefault) {
      throw new BadRequestError("fund.default.immutable");
    }
  }

  async actionAfterCreate(
    data: Fund,
    manager: EntityManager,
    req?: RequestContext,
    inputData?: DeepPartial<Fund>,
  ): Promise<void> {
    const initialBalance = Number((inputData as any)?.initialBalance || 0);
    if (initialBalance > 0) {
      const adjustmentRepository = manager.getRepository(FundAdjustment);
      const adjustmentCode = await generateCode(
        "fundadjustment",
        data.storeId ?? undefined,
      );

      await adjustmentRepository.save(
        adjustmentRepository.create({
          code: adjustmentCode,
          occurredAt: new Date(),
          fundId: data.id,
          fundSnapshot: {
            id: data.id,
            code: data.code,
            name: data.name,
            type: data.type,
            storeId: data.storeId,
          },
          expectedAmount: 0,
          countedAmount: initialBalance,
          deltaAmount: initialBalance,
          reason: "Số dư ban đầu",
          isInitial: true,
          creatorId: req?.userContext?.userId ?? null,
          creatorSnapshot: req?.userContext?.userSnapshot ?? null,
        }),
      );
    }

  }

  private getBalanceOffsetAt(req?: RequestContext): Date {
    const value = req?.query?.offsetAt;
    if (!value) return new Date();

    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  protected async attachMoreDataToEntities(
    entities: Fund[],
    req?: RequestContext,
  ): Promise<void> {
    await this.fundTransactionService.enrichFundsWithBalance(
      entities,
      this.getBalanceOffsetAt(req),
    );
  }

  protected async attachMoreDataToEntity(
    entity: Fund,
    req?: RequestContext,
  ): Promise<void> {
    await this.fundTransactionService.enrichFundsWithBalance(
      [entity],
      this.getBalanceOffsetAt(req),
    );
  }

  protected async attachActions(
    entity: Fund & { _actions?: ActionMap },
    _req?: RequestContext,
  ): Promise<void> {
    const actions = this.getDefaultAction();
    if (entity.isDefault) {
      delete actions.update;
      delete actions.delete;
    }
    entity._actions = actions;
  }
}
