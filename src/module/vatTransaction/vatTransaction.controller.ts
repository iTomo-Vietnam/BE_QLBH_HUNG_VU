import { inject, injectable } from "inversify";
import { Request, Response } from "express";
import { VatTransaction } from "@/database/models/VatTransaction";
import { BaseController } from "@/shared/base/BaseController";
import { VatTransactionService } from "./vatTransaction.service";
import { VAT_TRANSACTION_TYPES } from "./vatTransaction.types";
import { VatBalanceQueryDto } from "./vatTransaction.validator";
@injectable()
export class VatTransactionController extends BaseController<VatTransaction> {
  protected service: VatTransactionService;

  constructor(
    @inject(VAT_TRANSACTION_TYPES.Service)
    service: VatTransactionService,
  ) {
    super();
    this.service = service;
  }

  getBalance = async (req: Request, res: Response): Promise<void> => {
    const { occurredAt, excludeId } = req.query as unknown as VatBalanceQueryDto;
    const amount = await this.service.getBalanceAtDate(occurredAt, excludeId);

    res.json({
      statusCode: 200,
      success: true,
      message: "OK",
      data: { amount },
    });
  };
}

