import { ContainerModule } from "inversify";
import { IncomeExpenseRepository } from "./incomeExpense.repository";
import { IncomeExpenseService } from "./incomeExpense.service";
import { IncomeExpenseController } from "./incomeExpense.controller";
import { IncomeExpenseRouter } from "./incomeExpense.route";
import { INCOME_EXPENSE_TYPES } from "./incomeExpense.types";
import { FUND_TYPES } from "../fund/fund.types";
import { PARTNER_TYPES } from "../partner/partner.types";
import { ATTRIBUTE_TYPES } from "../attribute/attribute.types";
import { DEBT_TYPES } from "../debt/debt.types";
import { TRANSFER_NOTE_TYPES } from "../transferNote/transferNote.types";

export const incomeExpenseModule = new ContainerModule((bind) => {
  bind(INCOME_EXPENSE_TYPES.Repository).to(IncomeExpenseRepository).inSingletonScope();
  bind(INCOME_EXPENSE_TYPES.Service)
    .toDynamicValue((context) => new IncomeExpenseService(
      context.container.get(INCOME_EXPENSE_TYPES.Repository),
      context.container.get(FUND_TYPES.Repository),
      context.container.get(PARTNER_TYPES.PartnerRepository),
      context.container.get(ATTRIBUTE_TYPES.AttributeRepository),
      context.container.get(DEBT_TYPES.DebtRecalculateService),
      context.container.get(TRANSFER_NOTE_TYPES.Service),
    ))
    .inSingletonScope();
  bind(INCOME_EXPENSE_TYPES.Controller)
    .toDynamicValue((context) => new IncomeExpenseController(
      context.container.get(INCOME_EXPENSE_TYPES.Service),
    ))
    .inSingletonScope();
  bind(INCOME_EXPENSE_TYPES.Router)
    .toDynamicValue((context) => new IncomeExpenseRouter(
      context.container.get(INCOME_EXPENSE_TYPES.Controller),
    ))
    .inSingletonScope();
});
