import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { BaseService } from "@/shared/base/BaseService";
import { RequestContext } from "@/shared/types/interfaces";
import { BadRequestError } from "@/shared/types/errors";
import { generateCode } from "@/shared/utils/code.utils";
import { withTransaction } from "@/shared/base/TransactionManager";
import { InventoryAdjustment } from "@/database/models/store/InventoryAdjustment";
import { InventoryAdjustmentLine } from "@/database/models/store/InventoryAdjustmentLine";
import { InventoryAdjustmentRepository } from "./inventoryAdjustment.repository";
import { InventoryAdjustmentLineRepository } from "./inventoryAdjustmentLine.repository";
import { INVENTORY_ADJUSTMENT_TYPES } from "./inventoryAdjustment.types";
import { INVENTORY_TYPES } from "../inventory/inventory.types";
import { InventoryRecalculateService } from "../inventory/inventoryRecalculate.service";
import { PRODUCT_TYPES } from "../product/product.types";
import { ProductRepository } from "../product/product.repository";

@injectable()
export class InventoryAdjustmentService extends BaseService<InventoryAdjustment> {
  protected repository: InventoryAdjustmentRepository;
  protected uniqueFields: (keyof InventoryAdjustment)[] = ["code"];
  protected uniqueScope: (keyof InventoryAdjustment)[] = ["storeId"];
  protected timeField: keyof InventoryAdjustment = "occurredAt";
  protected searchableFields: (keyof InventoryAdjustment)[] = ["code", "reason"];
  constructor(
    @inject(INVENTORY_ADJUSTMENT_TYPES.Repository) repository: InventoryAdjustmentRepository,
    @inject(INVENTORY_ADJUSTMENT_TYPES.LineRepository) private lineRepository: InventoryAdjustmentLineRepository,
    @inject(PRODUCT_TYPES.ProductRepository) private productRepository: ProductRepository,
    @inject(INVENTORY_TYPES.InventoryRecalculateService) private inventory: InventoryRecalculateService,
  ) { super(); this.repository = repository; }

  private async prepareLines(lines: any[] | undefined, manager: EntityManager): Promise<void> {
    if (!Array.isArray(lines)) return;
    for (const line of lines) {
      if (!line.productId) throw new Error("inventory.adjustment.line.product.required");
      await this.productRepository.attachInfo(line, manager);
      if (!line.productSnapshot) throw new Error("product.not_found");
    }
  }

  private async prepareInventoryValues(
    lines: any[],
    storeId: string,
    occurredAt: Date,
    manager: EntityManager,
    excludedRefId?: string,
  ): Promise<{ totalQuantity: number; totalAmount: number }> {
    let totalQuantity = 0;
    let totalAmount = 0;
    const productIds = new Set<string>();

    for (const line of lines) {
      const productId = String(line.productId || "");
      if (!productId || productIds.has(productId)) throw new Error("inventory.adjustment.line.duplicate_product");
      productIds.add(productId);
      const countedQuantity = Number(line.countedQuantity ?? line.quantity ?? 0);
      if (!Number.isFinite(countedQuantity) || countedQuantity < 0) {
        throw new Error("inventory.adjustment.counted_quantity.invalid");
      }

      const conversionRate = Number(line.conversionRateAtTime) || 1;
      const expectedQuantity = await this.inventory.getQuantityBefore(
        productId,
        storeId,
        occurredAt,
        manager,
        excludedRefId,
      );
      const countedBaseQuantity = countedQuantity * conversionRate;
      const adjustmentQuantity = countedBaseQuantity - expectedQuantity;
      const costPrice = await this.inventory.getCostPriceBefore(
        productId,
        storeId,
        occurredAt,
        manager,
      );

      line.expectedQuantity = expectedQuantity;
      line.countedQuantity = countedBaseQuantity;
      line.adjustmentQuantity = adjustmentQuantity;
      line.adjustmentAmount = adjustmentQuantity * costPrice;
      totalQuantity += adjustmentQuantity;
      totalAmount += line.adjustmentAmount;
    }

    return { totalQuantity, totalAmount };
  }

  private async syncLines(adjustmentId: string, lines: any[], manager: EntityManager): Promise<string[]> {
    const repository = this.lineRepository.getRepository(manager);
    const existing = await repository.find({ where: { adjustmentId } as any });
    const oldProductIds = existing.map((line) => line.productId).filter((id): id is string => Boolean(id));
    const incomingIds = new Set<string>();
    for (const line of lines) {
      const entity = line.id ? existing.find((item) => item.id === line.id) : undefined;
      const payload = { ...line, adjustmentId }; delete payload.id;
      const saved = await repository.save((entity ? repository.merge(entity, payload) : repository.create(payload)) as any) as InventoryAdjustmentLine;
      incomingIds.add(saved.id);
    }
    for (const line of existing) if (!incomingIds.has(line.id)) await repository.delete(line.id);
    return [...new Set(oldProductIds)];
  }

  private async replay(id: string, manager: EntityManager, extraProductIds: string[] = []): Promise<void> {
    const adjustment = await this.repository.getRepository(manager).findOne({ where: { id }, relations: { lines: true } });
    if (!adjustment) return;
    const productIds = [...new Set([...extraProductIds, ...(adjustment.lines || []).map((line) => line.productId).filter((id): id is string => Boolean(id))])];
    for (const productId of productIds) await this.inventory.recalculateProductStoreFromDate(productId, adjustment.storeId, adjustment.occurredAt, manager);
  }

  async validateBeforeCreate(data: DeepPartial<InventoryAdjustment>, manager: EntityManager, req?: RequestContext): Promise<void> {
    if (!req?.storeContext?.storeId) throw new BadRequestError("Vui lòng chọn cửa hàng đang thao tác");
    if (data.storeId && data.storeId !== req.storeContext.storeId) throw new BadRequestError("Dữ liệu phải thuộc cửa hàng đang thao tác");
    data.storeId = req.storeContext.storeId;
    if (!data.code) data.code = await generateCode("inventoryadjustment", data.storeId);
    if (!data.occurredAt) data.occurredAt = new Date();
    if (!Array.isArray((data as any).lines) || !(data as any).lines.length) {
      throw new Error("inventory.adjustment.lines.required");
    }
    await this.prepareLines((data as any).lines, manager);
    const totals = await this.prepareInventoryValues(
      (data as any).lines,
      data.storeId,
      data.occurredAt as Date,
      manager,
    );
    data.totalAdjustmentQuantity = totals.totalQuantity;
    data.totalAdjustmentAmount = totals.totalAmount;
  }

  async update(id: string, data: DeepPartial<InventoryAdjustment>, manager?: EntityManager, req?: RequestContext): Promise<InventoryAdjustment | null> {
    const run = async (em: EntityManager): Promise<InventoryAdjustment | null> => {
      const payload = { ...(data as any) }; const lines = payload.lines; delete payload.lines;
      const current = await this.repository.getRepository(em).findOne({ where: { id }, relations: { lines: true } });
      if (!current) return null;
      if (!req?.storeContext?.storeId) throw new BadRequestError("Vui lòng chọn cửa hàng đang thao tác");
      if (current.storeId !== req.storeContext.storeId) throw new BadRequestError("Không thể cập nhật dữ liệu của cửa hàng khác");
      if (payload.storeId && payload.storeId !== current.storeId) throw new BadRequestError("Không thể chuyển dữ liệu sang cửa hàng khác");
      const storeId = (payload.storeId || current.storeId) as string;
      const occurredAt = new Date(payload.occurredAt || current.occurredAt);
      await this.prepareLines(lines, em);
      if (Array.isArray(lines)) {
        if (!lines.length) throw new Error("inventory.adjustment.lines.required");
        const totals = await this.prepareInventoryValues(lines, storeId, occurredAt, em, id);
        payload.totalAdjustmentQuantity = totals.totalQuantity;
        payload.totalAdjustmentAmount = totals.totalAmount;
      }
      const updated = await super.update(id, payload, em, req);
      if (!updated || !Array.isArray(lines)) return updated;
      const oldProductIds = await this.syncLines(id, lines, em);
      await this.replay(id, em, oldProductIds);
      return (await this.repository.getRepository(em).findOne({ where: { id }, relations: { lines: true } })) || updated;
    };
    return manager ? run(manager) : withTransaction(run);
  }

  async actionAfterCreate(data: InventoryAdjustment, manager: EntityManager): Promise<void> { await this.replay(data.id, manager); }
  async actionAfterUpdate(data: InventoryAdjustment, manager: EntityManager): Promise<void> { await this.replay(data.id, manager); }
  async validateBeforeDelete(data: InventoryAdjustment, manager: EntityManager, req?: RequestContext): Promise<void> { await super.validateBeforeDelete(data, manager, req); const current = await this.repository.getRepository(manager).findOne({ where: { id: data.id }, relations: { lines: true } }); if (current) (data as any).lines = current.lines; }
  async actionAfterDelete(data: InventoryAdjustment, manager: EntityManager): Promise<void> { const productIds = new Set<string>(((data as any).lines || []).map((line: InventoryAdjustmentLine) => line.productId).filter((id: string | null): id is string => Boolean(id))); for (const productId of productIds) await this.inventory.recalculateProductStoreFromDate(productId, data.storeId, data.occurredAt, manager); }
}
