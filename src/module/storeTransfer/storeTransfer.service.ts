import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { BaseService } from "@/shared/base/BaseService";
import { ActionMap, RequestContext } from "@/shared/types/interfaces";
import { withTransaction } from "@/shared/base/TransactionManager";
import {
  StoreTransfer,
  StoreTransferStatus,
} from "@/database/models/StoreTransfer";
import { StoreTransferLine } from "@/database/models/StoreTransferLine";
import { StoreTransferRepository } from "./storeTransfer.repository";
import { BadRequestError } from "@/shared/types/errors";
import { StoreTransferLineRepository } from "./storeTransferLine.repository";
import { STORE_TRANSFER_TYPES } from "./storeTransfer.types";
import { INVENTORY_TYPES } from "../inventory/inventory.types";
import { InventoryRecalculateService } from "../inventory/inventoryRecalculate.service";
import { PRODUCT_TYPES } from "../product/product.types";
import { ProductRepository } from "../product/product.repository";
import { ATTRIBUTE_TYPES } from "../attribute/attribute.types";
import { AttributeRepository } from "../attribute/attribute.repository";
import { STORE_TYPES } from "../store/store.types";
import { StoreRepository } from "../store/store.repository";
import { NOTIFICATION_TYPES } from "../notification/notification.types";
import { NotificationService } from "../notification/notification.service";
import { ActionType, NotificationType } from "@/database/models/Notification";

type TransferWithActions = StoreTransfer & { _actions?: ActionMap };

@injectable()
export class StoreTransferService extends BaseService<StoreTransfer> {
  protected repository: StoreTransferRepository;
  protected uniqueFields: (keyof StoreTransfer)[] = ["code"];
  protected timeField: keyof StoreTransfer = "occurredAt";
  protected searchableFields: (keyof StoreTransfer)[] = ["code", "reason"];

  constructor(
    @inject(STORE_TRANSFER_TYPES.Repository)
    repository: StoreTransferRepository,
    @inject(STORE_TRANSFER_TYPES.LineRepository)
    private lineRepository: StoreTransferLineRepository,
    @inject(PRODUCT_TYPES.ProductRepository)
    private productRepository: ProductRepository,
    @inject(ATTRIBUTE_TYPES.AttributeRepository)
    private attributeRepository: AttributeRepository,
    @inject(STORE_TYPES.StoreRepository)
    private storeRepository: StoreRepository,
    @inject(INVENTORY_TYPES.InventoryRecalculateService)
    private inventory: InventoryRecalculateService,
    @inject(NOTIFICATION_TYPES.NotificationService)
    private notificationService: NotificationService,
  ) {
    super();
    this.repository = repository;
  }

  protected async attachActions(entity: TransferWithActions): Promise<void> {
    const status = entity.status || StoreTransferStatus.PLANNED;
    const isPlanned = status === StoreTransferStatus.PLANNED;
    const isExported = status === StoreTransferStatus.EXPORTED;
    const isImported = status === StoreTransferStatus.IMPORTED;

    entity._actions = {
      ...this.getDefaultAction(),
      update: { can: isPlanned },
      delete: { can: isPlanned },
      export: { can: isPlanned },
      import: { can: isExported },
      cancel: { can: isPlanned || isExported || isImported },
    };
  }

  private async prepareLines(
    lines: any[] | undefined,
    manager: EntityManager,
  ): Promise<void> {
    if (!Array.isArray(lines)) return;
    for (const line of lines) {
      if (!line.productId)
        throw new Error("store.transfer.line.product.required");
      await this.productRepository.attachInfo(line, manager);
      if (!line.productSnapshot) throw new Error("product.not_found");
      await this.attributeRepository.attachUnitInfo(line, manager);
      await this.productRepository.attachUnitConversion(line, manager);
    }
  }

  private async validateTransferData(
    data: any,
    manager: EntityManager,
  ): Promise<void> {
    if (!data.fromStoreId || !data.toStoreId)
      throw new Error("store.transfer.store.required");
    if (data.fromStoreId === data.toStoreId)
      throw new Error("store.transfer.store.different");
    if (!data.occurredAt) data.occurredAt = new Date();
    if (!Array.isArray(data.lines) || !data.lines.length)
      throw new Error("store.transfer.lines.required");

    await this.prepareLines(data.lines, manager);
    const productIds = new Set<string>();
    for (const line of data.lines) {
      const quantity = Number(line.quantity) || 0;
      if (!line.productId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("store.transfer.line.quantity.invalid");
      }
      if (productIds.has(line.productId))
        throw new Error("store.transfer.line.duplicate_product");
      productIds.add(line.productId);
    }
  }

  private async syncLines(
    transferId: string,
    lines: any[],
    manager: EntityManager,
  ): Promise<string[]> {
    const repository = this.lineRepository.getRepository(manager);
    const existing = await repository.find({ where: { transferId } as any });
    const oldProductIds = existing
      .map((line) => line.productId)
      .filter((id): id is string => Boolean(id));
    const incomingIds = new Set<string>();

    for (const line of lines) {
      const entity = line.id
        ? existing.find((item) => item.id === line.id)
        : undefined;
      const payload = { ...line, transferId };
      delete payload.id;
      const saved = (await repository.save(
        (entity
          ? repository.merge(entity, payload)
          : repository.create(payload)) as any,
      )) as StoreTransferLine;
      incomingIds.add(saved.id);
    }
    for (const line of existing) {
      if (!incomingIds.has(line.id)) await repository.delete(line.id);
    }
    return [...new Set(oldProductIds)];
  }

  private getTimelineDates(transfer: Partial<StoreTransfer>): Date[] {
    return [
      transfer.occurredAt,
      transfer.exportedAt,
      transfer.importedAt,
      transfer.canceledAt,
    ]
      .filter((value): value is Date => Boolean(value))
      .map((value) => new Date(value));
  }

  private getTransferEarliestDate(...dates: (Date | undefined)[]): Date {
    const validDates = dates.filter((value): value is Date => Boolean(value));
    return new Date(Math.min(...validDates.map((value) => value.getTime())));
  }

  private async syncDifferenceCostPrices(
    transfer: StoreTransfer,
    manager: EntityManager,
  ): Promise<void> {
    if (
      transfer.status !== StoreTransferStatus.IMPORTED ||
      !transfer.exportedAt ||
      !transfer.importedAt
    )
      return;

    const repository = this.lineRepository.getRepository(manager);
    for (const line of transfer.lines || []) {
      if (!line.id || !line.productId) continue;
      const quantity =
        Math.abs(Number(line.quantity) || 0) *
        (Number(line.conversionRateAtTime) || 1);
      const fromCost = await this.inventory.getCostPriceBefore(
        line.productId,
        transfer.fromStoreId!,
        transfer.exportedAt,
        manager,
      );
      const toCost = await this.inventory.getCostPriceBefore(
        line.productId,
        transfer.toStoreId!,
        transfer.importedAt,
        manager,
      );
      await repository.update(line.id, {
        differenceCostPriceAmount: quantity * (toCost - fromCost),
      });
    }
  }

  private async replay(
    id: string,
    manager: EntityManager,
    extraProductIds: string[] = [],
    oldStores: string[] = [],
    fromDate?: Date,
  ): Promise<void> {
    const transfer = await this.repository.getRepository(manager).findOne({
      where: { id },
      relations: { lines: true },
    });
    if (!transfer) return;

    const productIds = [
      ...new Set([
        ...extraProductIds,
        ...(transfer.lines || [])
          .map((line) => line.productId)
          .filter((id): id is string => Boolean(id)),
      ]),
    ];
    const storeIds = [
      ...new Set(
        [...oldStores, transfer.fromStoreId, transfer.toStoreId].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    const replayFrom = this.getTransferEarliestDate(
      fromDate,
      ...this.getTimelineDates(transfer),
    );

    for (const productId of productIds) {
      for (const storeId of storeIds) {
        await this.inventory.recalculateProductStoreFromDate(
          productId,
          storeId,
          replayFrom,
          manager,
        );
      }
    }
  }

  async validateBeforeCreate(
    data: DeepPartial<StoreTransfer>,
    manager: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    if (!req?.storeContext?.storeId)
      throw new BadRequestError("Vui lòng chọn cửa hàng đang thao tác");
    if (data.fromStoreId && data.fromStoreId !== req.storeContext.storeId)
      throw new BadRequestError("Cửa hàng xuất phải là cửa hàng đang thao tác");
    data.status = StoreTransferStatus.PLANNED;
    data.exportedAt = null;
    data.exporterId = null;
    data.exporterSnapshot = null;
    data.importedAt = null;
    data.importerId = null;
    data.importerSnapshot = null;
    data.canceledAt = null;
    data.cancelerId = null;
    data.cancelerSnapshot = null;

    await this.storeRepository.attachInfo(data as any, manager);
    if (
      (data.fromStoreId && !data.fromStoreSnapshot) ||
      (data.toStoreId && !data.toStoreSnapshot)
    ) {
      throw new Error("store.not_found");
    }
    await this.validateTransferData(data, manager);
  }

  async update(
    id: string,
    data: DeepPartial<StoreTransfer>,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<StoreTransfer | null> {
    const run = async (em: EntityManager): Promise<StoreTransfer | null> => {
      const payload = { ...(data as any) };
      const lines = payload.lines;
      delete payload.lines;

      const current = await this.repository.getRepository(em).findOne({
        where: { id },
        relations: { lines: true },
      });
      if (!current) return null;
      if (!req?.storeContext?.storeId)
        throw new BadRequestError("Vui lòng chọn cửa hàng đang thao tác");
      if (current.fromStoreId !== req.storeContext.storeId)
        throw new BadRequestError(
          "Không thể cập nhật dữ liệu của cửa hàng khác",
        );
      if (
        (current.status || StoreTransferStatus.PLANNED) !==
        StoreTransferStatus.PLANNED
      ) {
        throw new Error("store.transfer.status_locked");
      }
      if (payload.status && payload.status !== StoreTransferStatus.PLANNED) {
        throw new Error("store.transfer.status_transition_required");
      }

      // Các mốc và người thực hiện chỉ được ghi bởi các API chuyển trạng thái.
      delete payload.exportedAt;
      delete payload.exporterId;
      delete payload.exporterSnapshot;
      delete payload.importedAt;
      delete payload.importerId;
      delete payload.importerSnapshot;
      delete payload.canceledAt;
      delete payload.cancelerId;
      delete payload.cancelerSnapshot;

      const oldStores = [current.fromStoreId, current.toStoreId].filter(
        (storeId): storeId is string => Boolean(storeId),
      );
      const oldOccurredAt = current.occurredAt;
      const transferData: any = {
        ...payload,
        fromStoreId: payload.fromStoreId || current.fromStoreId,
        toStoreId: payload.toStoreId || current.toStoreId,
        occurredAt: payload.occurredAt || current.occurredAt,
        lines: Array.isArray(lines) ? lines : current.lines,
      };

      await this.storeRepository.attachInfo(transferData, em);
      if (!transferData.fromStoreId || !transferData.toStoreId) {
        throw new Error("store.transfer.store.required");
      }
      if (transferData.fromStoreId === transferData.toStoreId) {
        throw new Error("store.transfer.store.different");
      }
      if (
        transferData.fromStoreSnapshot === null ||
        transferData.toStoreSnapshot === null
      ) {
        throw new Error("store.not_found");
      }
      if (Array.isArray(lines))
        await this.validateTransferData(transferData, em);

      if (payload.fromStoreId !== undefined)
        payload.fromStoreSnapshot = transferData.fromStoreSnapshot;
      if (payload.toStoreId !== undefined)
        payload.toStoreSnapshot = transferData.toStoreSnapshot;
      payload.status = StoreTransferStatus.PLANNED;

      const updated = await super.update(id, payload, em, req);
      if (!updated) return null;
      if (!Array.isArray(lines)) return updated;

      const oldProductIds = await this.syncLines(id, lines, em);
      await this.replay(id, em, oldProductIds, oldStores, oldOccurredAt);
      return (
        (await this.repository.getRepository(em).findOne({
          where: { id },
          relations: { lines: true },
        })) || updated
      );
    };

    return manager ? run(manager) : withTransaction(run);
  }

  private assertStoreScope(
    req: RequestContext | undefined,
    allowedStoreIds: (string | null)[],
  ): void {
    const storeId = req?.storeContext?.storeId;
    if (!storeId)
      throw new BadRequestError("Vui lòng chọn cửa hàng đang thao tác");
    if (!allowedStoreIds.includes(storeId))
      throw new BadRequestError(
        "Không thể thao tác với dữ liệu của cửa hàng khác",
      );
  }

  private async notifyTransferPending(
    transfer: StoreTransfer,
    status: StoreTransferStatus,
  ): Promise<void> {
    const targetStoreId =
      status === StoreTransferStatus.EXPORTED
        ? transfer.toStoreId
        : status === StoreTransferStatus.PLANNED
          ? transfer.fromStoreId
          : null;
    if (!targetStoreId) return;

    const userIds = await this.notificationService.findUsersWithPermission(
      targetStoreId,
      "storeTransfer",
      "complete",
    );
    if (!userIds.length) return;

    const message =
      status === StoreTransferStatus.EXPORTED
        ? `Phiếu chuyển hàng ${transfer.code} đã xuất hàng, đang chờ cửa hàng nhận nhập kho`
        : `Phiếu chuyển hàng ${transfer.code} đang chờ cửa hàng xuất hàng`;
    await this.notificationService.createNotificationByEntity(
      {
        id: transfer.id,
        code: transfer.code,
        entityType: "StoreTransfer",
        storeId: targetStoreId,
        fromStoreId: transfer.fromStoreId,
        toStoreId: transfer.toStoreId,
        message,
      },
      NotificationType.STORE_TRANSFER,
      status === StoreTransferStatus.EXPORTED
        ? ActionType.COMPLETE
        : ActionType.PENDING,
      userIds,
    );
  }

  private async transition(
    id: string,
    nextStatus: StoreTransferStatus,
    req?: RequestContext,
  ): Promise<StoreTransfer | null> {
    const updated = await withTransaction(async (em) => {
      const repository = this.repository.getRepository(em);
      const current = await repository.findOne({
        where: { id },
        relations: { lines: true },
      });
      if (!current) throw new Error("store.transfer.not_found");

      const currentStatus = current.status || StoreTransferStatus.PLANNED;
      const now = new Date();
      const userId = req?.userContext?.userId || null;
      const userSnapshot = req?.userContext?.userSnapshot || null;

      if (nextStatus === StoreTransferStatus.EXPORTED) {
        if (currentStatus !== StoreTransferStatus.PLANNED) {
          throw new Error("store.transfer.invalid_export_transition");
        }
        this.assertStoreScope(req, [current.fromStoreId]);
        // Chuyển kho không chặn theo tồn kho. Tồn kho là số liệu được tính
        // lại từ ledger và có thể âm theo nghiệp vụ của hệ thống.
        await this.validateTransferData(
          { ...current, occurredAt: now, lines: current.lines },
          em,
        );
      }

      if (nextStatus === StoreTransferStatus.IMPORTED) {
        if (currentStatus !== StoreTransferStatus.EXPORTED) {
          throw new Error("store.transfer.invalid_import_transition");
        }
        this.assertStoreScope(req, [current.toStoreId]);
      }

      if (nextStatus === StoreTransferStatus.CANCELED) {
        if (currentStatus === StoreTransferStatus.CANCELED) {
          throw new Error("store.transfer.already_canceled");
        }
        this.assertStoreScope(req, [current.fromStoreId, current.toStoreId]);
        // Không kiểm tra số dư kho nhận khi hủy. Việc đảo giao dịch có thể
        // làm số lượng âm và vẫn phải được ghi nhận trong ledger.
      }

      const oldTimeline = this.getTimelineDates(current);
      const payload: DeepPartial<StoreTransfer> = {
        status: nextStatus,
        updaterId: userId,
        updaterSnapshot: userSnapshot,
      };

      if (nextStatus === StoreTransferStatus.EXPORTED) {
        payload.exportedAt = now;
        payload.exporterId = userId;
        payload.exporterSnapshot = userSnapshot;
      } else if (nextStatus === StoreTransferStatus.IMPORTED) {
        payload.importedAt = now;
        payload.importerId = userId;
        payload.importerSnapshot = userSnapshot;
      } else {
        payload.canceledAt = now;
        payload.cancelerId = userId;
        payload.cancelerSnapshot = userSnapshot;
      }

      await repository.update(id, payload as any);
      const updated = await repository.findOne({
        where: { id },
        relations: { lines: true },
      });
      if (!updated) return null;

      await this.syncDifferenceCostPrices(updated, em);

      await this.replay(
        id,
        em,
        [],
        [current.fromStoreId, current.toStoreId].filter(
          (storeId): storeId is string => Boolean(storeId),
        ),
        this.getTransferEarliestDate(
          ...oldTimeline,
          ...this.getTimelineDates(updated),
        ),
      );
      return updated;
    });
    if (updated) await this.notifyTransferPending(updated, nextStatus);
    return updated;
  }

  async exportTransfer(
    id: string,
    req?: RequestContext,
  ): Promise<StoreTransfer | null> {
    return this.transition(id, StoreTransferStatus.EXPORTED, req);
  }

  async importTransfer(
    id: string,
    req?: RequestContext,
  ): Promise<StoreTransfer | null> {
    return this.transition(id, StoreTransferStatus.IMPORTED, req);
  }

  async cancel(
    id: string,
    req?: RequestContext,
  ): Promise<StoreTransfer | null> {
    return this.transition(id, StoreTransferStatus.CANCELED, req);
  }

  async actionAfterCreate(
    data: StoreTransfer,
    manager: EntityManager,
  ): Promise<void> {
    await this.replay(data.id, manager);
    await this.notifyTransferPending(data, StoreTransferStatus.PLANNED);
  }

  async actionAfterUpdate(
    data: StoreTransfer,
    manager: EntityManager,
  ): Promise<void> {
    await this.replay(data.id, manager);
  }

  async validateBeforeDelete(
    data: StoreTransfer,
    manager: EntityManager,
  ): Promise<void> {
    const current = await this.repository.getRepository(manager).findOne({
      where: { id: data.id },
      relations: { lines: true },
    });
    if (!current) return;
    if (
      (current.status || StoreTransferStatus.PLANNED) !==
      StoreTransferStatus.PLANNED
    ) {
      throw new Error("store.transfer.status_locked");
    }
    (data as any).lines = current.lines;
  }

  async actionAfterDelete(
    data: StoreTransfer,
    manager: EntityManager,
  ): Promise<void> {
    const productIds = new Set<string>(
      ((data as any).lines || [])
        .map((line: StoreTransferLine) => line.productId)
        .filter((id: string | null): id is string => Boolean(id)),
    );
    const stores = [data.fromStoreId, data.toStoreId].filter(
      (id): id is string => Boolean(id),
    );
    const fromDate = this.getTransferEarliestDate(
      ...this.getTimelineDates(data),
    );
    for (const productId of productIds) {
      for (const storeId of stores) {
        await this.inventory.recalculateProductStoreFromDate(
          productId,
          storeId,
          fromDate,
          manager,
        );
      }
    }
  }
}
