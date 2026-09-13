import { inject, injectable } from "inversify";
import ExcelJS from "exceljs";
import { DeepPartial, IsNull } from "typeorm";
import { Partner, PartnerType } from "@/database/models/Partner";
import { DebtAdjustment } from "@/database/models/DebtAdjustment";
import { DebtSide, Gender } from "@/shared/constants/enum";
import { TransactionType } from "@/shared/constants/enum";
import { DebtTransaction } from "@/database/models/DebtTransaction";
import { RequestContext } from "@/shared/types/interfaces";
import { BadRequestError } from "@/shared/types/errors";
import { PartnerService } from "@/module/partner/partner.service";
import { PARTNER_TYPES } from "@/module/partner/partner.types";
import { PartnerRepository } from "@/module/partner/partner.repository";
import { PartnerContactRepository } from "@/module/partnerContact/partnerContact.repository";
import { PARTNER_CONTACT_TYPES } from "@/module/partnerContact/partnerContact.types";
import { PartnerContactImportRowSchema } from "@/module/partnerContact/partnerContact.validator";
import { AttributeRepository } from "@/module/attribute/attribute.repository";
import { ATTRIBUTE_TYPES } from "@/module/attribute/attribute.types";
import { DebtAdjustmentService } from "@/module/debtAdjustment/debtAdjustment.service";
import { DEBT_ADJUSTMENT_TYPES } from "@/module/debtAdjustment/debtAdjustment.types";
import {
  PartnerImportRowSchema,
} from "@/module/partner/partner.validator";
import {
  PARTNER_FIELD_LIMITS,
  PartnerField,
  partnerMaxLengthMessage,
} from "@/module/partner/partner.constants";
import {
  ExcelEntityType,
  ImportDuplicateHandling,
  ImportErrorHandling,
  ImportOptions,
  ImportProgressCallback,
  ImportResult,
} from "../excel.types";
import { parseAddressFromExcel, parseDateDMY } from "@/shared/utils/address.util";
import {
  PARTNER_EXCEL_CONFIGS,
  PartnerExcelConfig,
  PARTNER_SHEET_NAMES,
  RawPartnerBankRow,
  RawPartnerContactRow,
  RawPartnerRow,
} from "./partner.excel.types";
import { AttributeType } from "@/database/models/Attribute";

@injectable()
export class PartnerExcelProcessor {
  constructor(
    @inject(PARTNER_TYPES.PartnerService)
    private partnerService: PartnerService,
    @inject(PARTNER_TYPES.PartnerRepository)
    private partnerRepository: PartnerRepository,
    @inject(PARTNER_CONTACT_TYPES.PartnerContactRepository)
    private partnerContactRepository: PartnerContactRepository,
    @inject(ATTRIBUTE_TYPES.AttributeRepository)
    private attributeRepository: AttributeRepository,
    @inject(DEBT_ADJUSTMENT_TYPES.Service)
    private debtAdjustmentService: DebtAdjustmentService,
    @inject(DEBT_ADJUSTMENT_TYPES.Repository)
    private debtAdjustmentRepository: any,
  ) {}

  async processImport(
    req: RequestContext,
    workbook: ExcelJS.Workbook,
    options: ImportOptions,
    onProgress?: ImportProgressCallback,
    config: PartnerExcelConfig = PARTNER_EXCEL_CONFIGS[options.entityType as "customer" | "supplier"],
  ): Promise<ImportResult> {
    const result: ImportResult = {
      totalRows: 0,
      successRows: 0,
      errorRows: 0,
      skippedRows: 0,
      errors: [],
      data: [],
    };
    const mainSheet = workbook.getWorksheet(config.mainSheetName)
      || workbook.getWorksheet(PARTNER_SHEET_NAMES.MAIN);
    if (!mainSheet) {
      throw new BadRequestError(`Không tìm thấy sheet '${config.mainSheetName}'`);
    }

    const rows = this.parseRows<RawPartnerRow>(mainSheet, config.columns);
    const contactSheet = workbook.getWorksheet(PARTNER_SHEET_NAMES.CONTACTS);
    const bankSheet = workbook.getWorksheet(PARTNER_SHEET_NAMES.BANKS);
    const contacts = this.groupByCode(this.parseRows<RawPartnerContactRow>(contactSheet, config.contactColumns));
    const banks = this.groupByCode(this.parseRows<RawPartnerBankRow>(bankSheet, config.bankColumns));
    result.totalRows = rows.length;
    this.report(result, onProgress);

    const codes = new Set(rows.map((row) => row.code).filter(Boolean));
    for (const [label, relationMap] of [["Người liên hệ", contacts], ["Ngân hàng", banks]] as const) {
      for (const [code] of relationMap) {
        if (!codes.has(code)) {
          result.errorRows++;
          result.errors.push({ row: 0, message: `${label}: không tìm thấy mã đối tác "${code}" trong sheet ${config.mainSheetName}` });
          if (options.errorHandling === ImportErrorHandling.STOP_ON_ERROR) return result;
        }
      }
    }

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const rowNumber = index + 2;
      try {
        const type = config.partnerType;
        if (!row.name) throw new Error("Tên đối tác không được để trống");
        this.validatePartnerImportRow(row);
        const existing = await this.findExisting(row, type);
        if (existing && options.duplicateHandling === ImportDuplicateHandling.SKIP) {
          result.skippedRows++;
          this.report(result, onProgress);
          continue;
        }
        if (existing && options.duplicateHandling === ImportDuplicateHandling.STOP) {
          throw new Error(`Đối tác "${existing.code}" đã tồn tại`);
        }
        const relationCode = row.code || existing?.code || "";

        if (row.isOrganization === false && contacts.has(relationCode)) {
          throw new Error("Người liên hệ chỉ được khai báo cho đơn vị tổ chức");
        }
        if (row.isOrganization !== false && contacts.has(relationCode)) {
          this.validateContactImportRows(contacts.get(relationCode)!);
        }

        const parsedAddress = row.address ? parseAddressFromExcel(row.address) : null;
        const data: DeepPartial<Partner> = {
          type,
          code: row.code || undefined,
          name: row.name,
          isOrganization: row.isOrganization ?? true,
          groupId: await this.findGroup(row.groupName, type, req),
          taxCode: row.taxCode || null,
          identityCode: row.identityCode || null,
          phone: row.phone || null,
          email: row.email || null,
          gender: type === PartnerType.CUSTOMER ? (this.gender(row.gender) || null) : null,
          dob: type === PartnerType.CUSTOMER ? (row.dob || null) : null,
          address: parsedAddress
            ? { ...parsedAddress, isPermanent: true }
            : undefined,
          maxDebtAmount: this.optionalNumber(row.maxDebtAmount, "Hạn mức công nợ"),
          note: row.note || null,
          banks: banks.has(relationCode) ? this.toBanks(banks.get(relationCode)!) : undefined,
          representative: this.toRepresentative(row),
        };
        if (row.isOrganization !== false && contacts.has(relationCode)) {
          (data as any).contacts = contacts.get(relationCode)!.map((contact) => this.toContact(contact));
        }
        if (existing) delete (data as any).contacts;

        const saved = existing
          ? await this.partnerService.update(existing.id, data, undefined, req)
          : await this.partnerService.create(data, undefined, req);
        if (!saved) throw new Error("Không thể lưu đối tác");

        // Khi sheet quan hệ xuất hiện, nội dung của sheet là trạng thái đầy đủ cần đồng bộ.
        if (existing && bankSheet) {
          await this.partnerRepository.getRepository().update(saved.id, {
            banks: this.toBanks(banks.get(relationCode) || []),
          } as any);
        }
        if (contactSheet && row.isOrganization !== false) {
          await this.replaceContacts(saved.id, contacts.get(relationCode) || []);
        }

        await this.adjustDebtIfProvided(saved.id, row, existing, req, config.debtSide);
        result.successRows++;
        result.data.push(saved);
        this.report(result, onProgress);
      } catch (error: any) {
        result.errorRows++;
        result.errors.push({
          row: rowNumber,
          message: this.getImportErrorMessage(error, row),
          data: row as any,
        });
        this.report(result, onProgress);
        if (options.errorHandling === ImportErrorHandling.STOP_ON_ERROR) break;
      }
    }
    return result;
  }

  private async findExisting(row: RawPartnerRow, type: PartnerType): Promise<Partner | null> {
    if (row.code) {
      const byCode = await this.partnerRepository.findOne({ where: { code: row.code, type, deletedAt: IsNull() } as any });
      if (byCode) return byCode;
    }
    const candidates: any[] = [];
    if (row.phone) candidates.push({ phone: row.phone, type, deletedAt: IsNull() });
    if (row.email) candidates.push({ email: row.email, type, deletedAt: IsNull() });
    if (!candidates.length) return null;
    return this.partnerRepository.findOne({ where: candidates as any });
  }

  private async findGroup(name: string | undefined, type: PartnerType, req: RequestContext): Promise<string | null> {
    if (!name) return null;
    const groupType = type === PartnerType.SUPPLIER
      ? AttributeType.SUPPLIER_GROUP
      : type === PartnerType.SHIPPER
        ? AttributeType.SHIPPER_GROUP
        : AttributeType.CUSTOMER_GROUP;
    return this.attributeRepository.findOrCreateAttribute(
      { name, type: groupType },
      req,
    );
  }

  private async adjustDebtIfProvided(
    id: string,
    row: RawPartnerRow,
    existing: Partner | null,
    req: RequestContext,
    side: DebtSide,
  ): Promise<void> {
    const target = row.currentDebtAmount;
    if (target === undefined) return;
    if (!Number.isFinite(target)) throw new Error("Số dư công nợ phải là số hợp lệ");
    const current = await this.getCurrentDebt(id, side);
    if (Math.abs(current.amount - target) < 0.005) return;
    await this.debtAdjustmentService.create({
      partnerId: id,
      occurredAt: new Date(),
      side,
      expectedAmount: current.amount,
      countedAmount: target,
      deltaAmount: target - current.amount,
      reason: "Điều chỉnh công nợ từ Excel",
      isInitial: !existing && current.count === 0,
    } as DeepPartial<DebtAdjustment>, undefined, req);
  }

  private async getCurrentDebt(partnerId: string, side: DebtSide): Promise<{ amount: number; count: number }> {
    const adjustmentRow = await this.debtAdjustmentRepository.getRepository().createQueryBuilder("adjustment")
      .select("COALESCE(SUM(adjustment.deltaAmount), 0)", "amount")
      .addSelect("COUNT(adjustment.id)", "count")
      .where("adjustment.deletedAt IS NULL")
      .andWhere("adjustment.partnerId = :partnerId", { partnerId })
      .andWhere("adjustment.side = :side", { side })
      .getRawOne();
    const transactionRow = await this.debtAdjustmentRepository.getRepository().manager.getRepository(DebtTransaction)
      .createQueryBuilder("transaction")
      .select("COALESCE(SUM(CASE WHEN transaction.type = :inType THEN transaction.amount ELSE -transaction.amount END), 0)", "amount")
      .addSelect("COUNT(transaction.id)", "count")
      .where("transaction.deletedAt IS NULL")
      .andWhere("transaction.partnerId = :partnerId", { partnerId })
      .andWhere("transaction.side = :side", { side })
      .setParameter("inType", TransactionType.IN)
      .getRawOne();
    return {
      amount: (Number(adjustmentRow?.amount) || 0) + (Number(transactionRow?.amount) || 0),
      count: (Number(adjustmentRow?.count) || 0) + (Number(transactionRow?.count) || 0),
    };
  }

  private async replaceContacts(partnerId: string, rows: RawPartnerContactRow[]): Promise<void> {
    const repository = this.partnerContactRepository.getRepository();
    await repository.createQueryBuilder().delete().from("partner_contacts").where("partnerId = :partnerId", { partnerId }).execute();
    if (!rows.length) return;
    const entities = rows.map((row) => repository.create({
      partnerId,
      name: row.name,
      phone: row.phone || null,
      email: row.email || null,
      identityCode: row.identityCode || null,
      banks: this.toBanks([row]),
    } as any) as any);
    await repository.save(entities as any);
  }

  private toContact(row: RawPartnerContactRow): any {
    return {
      name: row.name,
      phone: row.phone || null,
      email: row.email || null,
      identityCode: row.identityCode || null,
      banks: this.toBanks([row]),
    };
  }

  private toBanks(rows: Array<RawPartnerBankRow | RawPartnerContactRow>): any[] {
    return rows
      .filter((row) => row.bankName || row.accountNumber || row.accountHolder || row.branch)
      .map((row) => ({ bankName: row.bankName || null, accountNumber: row.accountNumber || null, accountHolder: row.accountHolder || null, branch: row.branch || null }));
  }

  private toRepresentative(row: RawPartnerRow): any {
    const value = {
      name: row.representativeName || null,
      phone: row.representativePhone || null,
      email: row.representativeEmail || null,
      identityCode: row.representativeIdentityCode || null,
    };
    return Object.values(value).some(Boolean) ? value : null;
  }

  private parseRows<T extends Record<string, any>>(sheet: ExcelJS.Worksheet | undefined, columns: { field: string; header: string }[]): T[] {
    if (!sheet) return [];
    const indexes = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, columnNumber) => {
      const header = this.normalizeHeader(this.text(cell.value));
      const column = columns.find((item) => this.isColumnHeader(item.field, item.header, header));
      if (column) indexes.set(column.field, columnNumber);
    });
    const rows: T[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const value: Record<string, any> = {};
      indexes.forEach((columnNumber, field) => { value[field] = this.cellValue(row.getCell(columnNumber).value, field); });
      if (Object.values(value).some((item) => item !== undefined && item !== "")) rows.push(value as T);
    });
    return rows;
  }

  private groupByCode<T extends { partnerCode: string }>(rows: T[]): Map<string, T[]> {
    const result = new Map<string, T[]>();
    rows.forEach((row) => {
      row.partnerCode = this.text(row.partnerCode) as T["partnerCode"];
      if (!row.partnerCode) return;
      const current = result.get(row.partnerCode) || [];
      current.push(row);
      result.set(row.partnerCode, current);
    });
    return result;
  }

  private cellValue(value: unknown, field: string): any {
    if (field === "maxDebtAmount" || field.endsWith("DebtAmount")) return this.number(value);
    if (field === "dob") return parseDateDMY(this.text(value));
    if (field === "gender") return this.gender(value);
    if (field === "isOrganization" || field === "isPermanent") return this.boolean(value);
    return this.text(value) || undefined;
  }

  private optionalNumber(value: number | undefined, label: string): number | null {
    if (value === undefined) return null;
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} phải là số không âm`);
    return value;
  }

  private validatePartnerImportRow(row: RawPartnerRow): void {
    const validation = PartnerImportRowSchema.safeParse(row);
    if (!validation.success) {
      throw new Error(this.formatValidationIssues(validation.error));
    }
  }

  private validateContactImportRows(rows: RawPartnerContactRow[]): void {
    for (const row of rows) {
      const validation = PartnerContactImportRowSchema.safeParse(row);
      if (!validation.success) {
        throw new Error(`Người liên hệ: ${this.formatValidationIssues(validation.error)}`);
      }
    }
  }

  private formatValidationIssues(error: { issues: Array<{ message: string }> }): string {
    return [...new Set(error.issues.map((issue) => issue.message))].join("; ");
  }

  private getImportErrorMessage(error: any, row: RawPartnerRow): string {
    const message = String(error?.message || "Dòng dữ liệu không hợp lệ");
    if (!/value too long for type character varying/i.test(message)) return message;

    const exceededField = this.findExceededPartnerField(row);
    if (exceededField) return partnerMaxLengthMessage(exceededField);

    const maxLength = message.match(/character varying\((\d+)\)/i)?.[1];
    return maxLength
      ? `Một trường văn bản có độ dài tối đa là ${maxLength} ký tự`
      : "Một trường văn bản vượt quá độ dài cho phép";
  }

  private findExceededPartnerField(row: RawPartnerRow): PartnerField | undefined {
    const fields: Array<[PartnerField, unknown]> = [
      ["code", row.code],
      ["name", row.name],
      ["email", row.email],
      ["phone", row.phone],
      ["taxCode", row.taxCode],
      ["groupName", row.groupName],
      ["representativeName", row.representativeName],
      ["representativeEmail", row.representativeEmail],
      ["representativePhone", row.representativePhone],
      ["representativeIdentityCode", row.representativeIdentityCode],
    ];
    return fields.find(([field, value]) => this.textLength(value) > PARTNER_FIELD_LIMITS[field])?.[0];
  }

  private textLength(value: unknown): number {
    return Array.from(this.text(value)).length;
  }

  private text(value: unknown): string {
    if (value && typeof value === "object" && "text" in value) return String((value as any).text).trim();
    return String(value ?? "").trim();
  }

  private number(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") return undefined;
    const parsed = typeof value === "number" ? value : Number(this.text(value).replace(/,/g, ""));
    return parsed;
  }

  private boolean(value: unknown): boolean | undefined {
    const normalized = this.normalizeHeader(value);
    if (!normalized) return undefined;
    return ["co", "true", "1", "yes", "x", "to chuc"].includes(normalized);
  }

  private gender(value: unknown): Gender | undefined {
    const normalized = this.normalizeHeader(value);
    if (["male", "nam"].includes(normalized)) return Gender.MALE;
    if (["female", "nu"].includes(normalized)) return Gender.FEMALE;
    if (["other", "khac"].includes(normalized)) return Gender.OTHER;
    return undefined;
  }

  private normalizeHeader(value: unknown): string {
    return this.text(value).replace(/\(\*\)/g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  private isColumnHeader(field: string, columnHeader: string, header: string): boolean {
    if (this.normalizeHeader(columnHeader) === header || field.toLowerCase() === header) {
      return true;
    }

    // FE labels the same generic partner fields as "Tên khách hàng" or
    // "Tên nhà cung cấp" depending on the selected Excel entity.
    if (field === "name") {
      return ["ten", "ten doi tac", "ten khach hang", "ten nha cung cap"].includes(header);
    }
    if (field === "groupName") {
      return ["nhom", "nhom doi tac", "nhom khach hang", "nhom nha cung cap"].includes(header);
    }
    if (field === "isOrganization") {
      return ["loai hinh", "phan loai don vi"].includes(header);
    }
    if (field === "partnerCode") {
      return ["ma doi tac", "ma khach hang", "ma nha cung cap"].includes(header);
    }
    return false;
  }

  private report(result: ImportResult, callback?: ImportProgressCallback): void {
    callback?.({
      totalRows: result.totalRows,
      processedRows: result.successRows + result.errorRows + result.skippedRows,
      successRows: result.successRows,
      errorRows: result.errorRows,
      skippedRows: result.skippedRows,
    });
  }
}

