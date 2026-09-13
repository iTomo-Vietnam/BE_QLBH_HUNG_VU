import { inject, injectable } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { BaseService } from "@/shared/base/BaseService";
import { RequestContext } from "@/shared/types/interfaces";
import { BadRequestError } from "@/shared/types/errors";
import { generateCode } from "@/shared/utils/code.utils";
import { withTransaction } from "@/shared/base/TransactionManager";
import { InternalExport, InternalExportType } from "@/database/models/store/InternalExport";
import { InternalExportLine } from "@/database/models/store/InternalExportLine";
import { InternalExportRepository } from "./internalExport.repository";
import { InternalExportLineRepository } from "./internalExportLine.repository";
import { INTERNAL_EXPORT_TYPES } from "./internalExport.types";
import { INVENTORY_TYPES } from "../inventory/inventory.types";
import { InventoryRecalculateService } from "../inventory/inventoryRecalculate.service";
import { PRODUCT_TYPES } from "../product/product.types";
import { ProductRepository } from "../product/product.repository";
import { ATTRIBUTE_TYPES } from "../attribute/attribute.types";
import { AttributeRepository } from "../attribute/attribute.repository";

@injectable()
export class InternalExportService extends BaseService<InternalExport> {
  protected repository: InternalExportRepository;
  protected uniqueFields: (keyof InternalExport)[] = ["code"];
  protected uniqueScope: (keyof InternalExport)[] = ["storeId"];
  protected timeField: keyof InternalExport = "occurredAt";
  protected searchableFields: (keyof InternalExport)[] = ["code", "reason"];

  constructor(
    @inject(INTERNAL_EXPORT_TYPES.Repository) repository: InternalExportRepository,
    @inject(INTERNAL_EXPORT_TYPES.LineRepository) private lineRepository: InternalExportLineRepository,
    @inject(PRODUCT_TYPES.ProductRepository) private productRepository: ProductRepository,
    @inject(ATTRIBUTE_TYPES.AttributeRepository) private attributeRepository: AttributeRepository,
    @inject(INVENTORY_TYPES.InventoryRecalculateService) private inventory: InventoryRecalculateService,
  ) {
    super();
    this.repository = repository;
  }

  private async prepareLines(lines: any[] | undefined, manager: EntityManager): Promise<void> {
    if (!Array.isArray(lines)) return;
    for (const line of lines) {
      if (!line.productId) throw new Error("internal.export.line.product.required");
      const quantity = Number(line.quantity) || 0;
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("internal.export.line.quantity.invalid");
      await this.productRepository.attachInfo(line, manager);
      if (!line.productSnapshot) throw new Error("product.not_found");
      await this.attributeRepository.attachUnitInfo(line, manager);
      await this.productRepository.attachUnitConversion(line, manager);
    }
  }

  private async validateInventory(
    lines: any[],
    storeId: string,
    occurredAt: Date,
    manager: EntityManager,
    excludedRefId?: string,
  ): Promise<void> {
    const quantities = new Map<string, number>();
    const productIds = new Set<string>();
    for (const line of lines) {
      if (productIds.has(line.productId)) throw new Error("internal.export.line.duplicate_product");
      productIds.add(line.productId);
      const quantity = (Number(line.quantity) || 0) * (Number(line.conversionRateAtTime) || 1);
      quantities.set(line.productId, (quantities.get(line.productId) || 0) + quantity);
    }
    for (const [productId, quantity] of quantities) {
      await this.inventory.assertAvailable(productId, storeId, quantity, occurredAt, manager, excludedRefId);
    }
  }

  private async syncLines(id: string, lines: any[], manager: EntityManager): Promise<string[]> {
    const repository = this.lineRepository.getRepository(manager);
    const existing = await repository.find({ where: { internalExportId: id } as any });
    const oldProductIds = existing.map((line) => line.productId).filter((value): value is string => Boolean(value));
    const incomingIds = new Set<string>();
    for (const line of lines) {
      const entity = line.id ? existing.find((item) => item.id === line.id) : undefined;
      const payload = { ...line, internalExportId: id };
      delete payload.id;
      const saved = await repository.save((entity ? repository.merge(entity, payload) : repository.create(payload)) as any) as InternalExportLine;
      incomingIds.add(saved.id);
    }
    for (const line of existing) if (!incomingIds.has(line.id)) await repository.delete(line.id);
    return [...new Set(oldProductIds)];
  }

  private async replay(id: string, manager: EntityManager, extraProductIds: string[] = [], oldStoreId?: string, fromDate?: Date): Promise<void> {
    const item = await this.repository.getRepository(manager).findOne({ where: { id }, relations: { lines: true } });
    if (!item) return;
    const productIds = [...new Set([...extraProductIds, ...(item.lines || []).map((line) => line.productId).filter((value): value is string => Boolean(value))])];
    const replayFrom = fromDate && fromDate < item.occurredAt ? fromDate : item.occurredAt;
    for (const productId of productIds) {
      for (const storeId of [...new Set([oldStoreId, item.storeId].filter((value): value is string => Boolean(value)))]) {
        await this.inventory.recalculateProductStoreFromDate(productId, storeId, replayFrom, manager);
      }
    }
  }

  async validateBeforeCreate(data: DeepPartial<InternalExport>, manager: EntityManager, req?: RequestContext): Promise<void> {
    if (!req?.storeContext?.storeId) throw new BadRequestError("Vui lòng chọn cửa hàng đang thao tác");
    if (data.storeId && data.storeId !== req.storeContext.storeId) throw new BadRequestError("Dữ liệu phải thuộc cửa hàng đang thao tác");
    data.storeId = req.storeContext.storeId;
    if (!data.type) data.type = InternalExportType.USAGE;
    if (!Object.values(InternalExportType).includes(data.type as InternalExportType)) throw new Error("internal.export.type.invalid");
    if (!data.code) data.code = await generateCode("internalexport", data.storeId);
    if (!data.occurredAt) data.occurredAt = new Date();
    if (!Array.isArray((data as any).lines) || !(data as any).lines.length) throw new Error("internal.export.lines.required");
    await this.prepareLines((data as any).lines, manager);
    await this.validateInventory((data as any).lines, data.storeId, data.occurredAt as Date, manager);
  }

  async update(id: string, data: DeepPartial<InternalExport>, manager?: EntityManager, req?: RequestContext): Promise<InternalExport | null> {
    const run = async (em: EntityManager): Promise<InternalExport | null> => {
      const payload = { ...(data as any) };
      const lines = payload.lines;
      delete payload.lines;
      const current = await this.repository.getRepository(em).findOne({ where: { id }, relations: { lines: true } });
      if (!current) return null;
      if (!req?.storeContext?.storeId) throw new BadRequestError("Vui lòng chọn cửa hàng đang thao tác");
      if (current.storeId !== req.storeContext.storeId) throw new BadRequestError("Không thể cập nhật dữ liệu của cửa hàng khác");
      if (payload.storeId && payload.storeId !== current.storeId) throw new BadRequestError("Không thể chuyển dữ liệu sang cửa hàng khác");
      const storeId = (payload.storeId || current.storeId) as string;
      if (payload.type !== undefined && !Object.values(InternalExportType).includes(payload.type as InternalExportType)) throw new Error("internal.export.type.invalid");
      const occurredAt = new Date(payload.occurredAt || current.occurredAt);
      if (Array.isArray(lines)) {
        if (!lines.length) throw new Error("internal.export.lines.required");
        await this.prepareLines(lines, em);
        await this.validateInventory(lines, storeId, occurredAt, em, id);
      }
      const updated = await super.update(id, payload, em, req);
      if (!updated || !Array.isArray(lines)) return updated;
      const oldProductIds = await this.syncLines(id, lines, em);
      await this.replay(id, em, oldProductIds, current.storeId, current.occurredAt);
      return (await this.repository.getRepository(em).findOne({ where: { id }, relations: { lines: true } })) || updated;
    };
    return manager ? run(manager) : withTransaction(run);
  }

  async actionAfterCreate(data: InternalExport, manager: EntityManager): Promise<void> { await this.replay(data.id, manager); }
  async actionAfterUpdate(data: InternalExport, manager: EntityManager): Promise<void> { await this.replay(data.id, manager); }
  async validateBeforeDelete(data: InternalExport, manager: EntityManager): Promise<void> {
    const current = await this.repository.getRepository(manager).findOne({ where: { id: data.id }, relations: { lines: true } });
    if (current) (data as any).lines = current.lines;
  }
  async actionAfterDelete(data: InternalExport, manager: EntityManager): Promise<void> {
    const products = new Set<string>(((data as any).lines || []).map((line: InternalExportLine) => line.productId).filter((value: string | null): value is string => Boolean(value)));
    for (const productId of products) await this.inventory.recalculateProductStoreFromDate(productId, data.storeId, data.occurredAt, manager);
  }
}
