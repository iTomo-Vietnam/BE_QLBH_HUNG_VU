import { inject, injectable } from "inversify";
import { Request, Response } from "express";
import { BadRequestError } from "@/shared/types/errors";
import { DEBT_TYPES } from "./debt.types";
import { DebtService } from "./debt.service";
import {
  GetPartnerDebtReportQueryDto,
  GetTransactionDetailsQueryDto,
  DebtBalanceQueryDto,
} from "./debt.validator";

/** Controller cho báo cáo công nợ, không dùng CRUD BaseController. */
@injectable()
export class DebtController {
  constructor(
    @inject(DEBT_TYPES.DebtService)
    private debtService: DebtService,
  ) {}

  getPartnerDebtReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const query = req.query as unknown as GetPartnerDebtReportQueryDto;
      const result = await this.debtService.getPartnerDebtReport(query);
      res.json(result);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        throw new BadRequestError("Invalid query parameters", error.errors);
      }
      throw error;
    }
  };

  getTransactionDetails = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const query = req.query as unknown as GetTransactionDetailsQueryDto;
      const result = await this.debtService.getTransactionDetails(query);
      res.json(result);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        throw new BadRequestError("Invalid query parameters", error.errors);
      }
      throw error;
    }
  };

  getBalance = async (req: Request, res: Response): Promise<void> => {
    const { offsetAt, excludeId } = req.query as unknown as DebtBalanceQueryDto;
    const data = offsetAt
      ? await this.debtService.getDebtAtDate(
          req.params.partnerId,
          offsetAt,
          undefined,
          undefined,
          excludeId,
        )
      : await this.debtService.getCurrentBalance(req.params.partnerId);
    res.json({
      statusCode: 200,
      success: true,
      message: "OK",
      data,
    });
  };
}

