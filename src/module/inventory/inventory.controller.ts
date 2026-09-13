import { inject, injectable } from "inversify";
import { Request, Response } from "express";
import { INVENTORY_TYPES } from "./inventory.types";
import { InventoryService } from "./inventory.service";
import {
  GetStockReportQueryDto,
  GetTransactionDetailsQueryDto,
} from "./inventory.validator";
import { BadRequestError } from "@/shared/types/errors";

/**
 * Inventory Controller
 * Xử lý các request liên quan đến báo cáo tồn kho
 */
@injectable()
export class InventoryController {
  constructor(
    @inject(INVENTORY_TYPES.InventoryService)
    private inventoryService: InventoryService,
  ) {}

  /**
   * GET /api/client/inventory/stock-report
   * Báo cáo tồn kho theo product (có thể expand ra variants)
   */
  getStockReport = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate query parameters
      const validatedQuery = req.query as unknown as GetStockReportQueryDto;

      const result = await this.inventoryService.getStockReport(validatedQuery, req.availableStoreIds);

      res.json(result);
    } catch (error: any) {
      if (error.name === "ZodError") {
        throw new BadRequestError("Invalid query parameters", error.errors);
      }
      throw error;
    }
  };

  /**
   * GET /api/client/inventory/transactions
   * Chi tiết transactions (tổng hợp nhập xuất)
   */
  getTransactionDetails = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      // Validate query parameters
      const validatedQuery =
        req.query as unknown as GetTransactionDetailsQueryDto;

      const result =
        await this.inventoryService.getTransactionDetails(validatedQuery, req.availableStoreIds);

      res.json(result);
    } catch (error: any) {
      if (error.name === "ZodError") {
        throw new BadRequestError("Invalid query parameters", error.errors);
      }
      throw error;
    }
  };
}
