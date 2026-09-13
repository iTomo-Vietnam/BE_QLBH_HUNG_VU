import { inject, injectable } from "inversify";
import { NextFunction, Request, Response } from "express";
import { BaseController } from "@/shared/base/BaseController";
import { Product } from "@/database/models/Product";
import { PRODUCT_TYPES } from "./product.types";
import { ProductService } from "./product.service";

@injectable()
export class ProductController extends BaseController<Product> {
  protected service: ProductService;

  constructor(@inject(PRODUCT_TYPES.ProductService) service: ProductService) {
    super();
    this.service = service;
  }

  changeGroup = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids, groupId = null } = req.body;
      const affected = await this.service.changeGroup(
        ids,
        groupId,
        undefined,
        this.service.getReqContext(req),
      );
      return res.json({
        success: true,
        data: { ids, groupId, affected },
        statusCode: 200,
        message: "product.group_updated",
      });
    } catch (error) {
      next(error);
    }
  };

  stopSelling = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids, storeId } = req.body;
      const affected = await this.service.stopSelling(
        ids,
        storeId,
        undefined,
        this.service.getReqContext(req),
      );
      return res.json({
        success: true,
        data: { ids, storeId: storeId || null, affected },
        statusCode: 200,
        message: "product.stopped_selling",
      });
    } catch (error) {
      next(error);
    }
  };

  getPriceHistories = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await this.service.getPriceHistories(
        req.query as any,
        this.service.getReqContext(req),
      );
      return res.json({ success: true, data, statusCode: 200, message: "OK" });
    } catch (error) {
      next(error);
    }
  };

  getByCodes = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await this.service.getByCodes(
        req.body.codes,
        this.service.getReqContext(req),
      );
      return res.json({ success: true, data, statusCode: 200, message: "OK" });
    } catch (error) {
      next(error);
    }
  };

  updateStoreCost = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const storeId = String(
        req.body.storeId ||
          req.headers["x-store-id"] ||
          req.query.storeId ||
          "",
      );
      const contextStoreId = req.storeContext?.storeId;
      const costPrice = Number(req.body.costPrice);
      if (
        !contextStoreId ||
        storeId !== contextStoreId ||
        !Number.isFinite(costPrice) ||
        costPrice < 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Vui lòng chọn đúng cửa hàng đang thao tác và nhập giá vốn hợp lệ",
          statusCode: 400,
        });
      }
      await this.service.updateStoreCost(req.params.id, storeId, costPrice);
      return res.json({
        success: true,
        data: { productId: req.params.id, storeId, costPrice },
        statusCode: 200,
        message: "price.updated",
      });
    } catch (error) {
      next(error);
    }
  };
}
