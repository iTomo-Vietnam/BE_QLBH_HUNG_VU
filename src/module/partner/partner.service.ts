import { injectable, inject } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { BaseService } from "@/shared/base/BaseService";
import { BadRequestError, IError } from "@/shared/types/errors";
import { RequestContext } from "@/shared/types/interfaces";
import { Partner, PartnerType } from "@/database/models";
import { PARTNER_TYPES } from "./partner.types";
import { PartnerRepository } from "./partner.repository";
import { PartnerContactRepository } from "../partnerContact/partnerContact.repository";
import { PARTNER_CONTACT_TYPES } from "../partnerContact/partnerContact.types";
import { PartnerQueryDto } from "./partner.validator";
import { DEBT_TYPES } from "../debt/debt.types";
import { DebtService } from "../debt/debt.service";

/**
 * Partner Service - Tenant Entity
 */
@injectable()
export class PartnerService extends BaseService<Partner> {
  protected repository: PartnerRepository;
  protected uniqueFields: (keyof Partner)[] = ["code", "email", "phone"];
  protected searchableFields = [
    "name",
    "code",
    "email",
    "phone",
    "taxCode",
    "note",
    "address.state",
    "address.ward",
    "address.detail",
    "group.name",
  ];

  constructor(
    @inject(PARTNER_TYPES.PartnerRepository)
    partnerRepository: PartnerRepository,
    @inject(PARTNER_CONTACT_TYPES.PartnerContactRepository)
    private partnerContactRepository: PartnerContactRepository,
    @inject(DEBT_TYPES.DebtService)
    private debtService: DebtService,
  ) {
    super();
    this.repository = partnerRepository;
  }

  protected async attachMoreDataToEntities(
    entities: Partner[],
    req?: RequestContext,
  ): Promise<void> {
    for (const entity of entities) {
      const { offsetAt = new Date() } =
        (req?.query as unknown as PartnerQueryDto) || {};
      const { payableDebtAmount, receivableDebtAmount } =
        await this.debtService.getDebtAtDate(entity.id, offsetAt);
      entity.payableDebtAmount = payableDebtAmount;
      entity.receivableDebtAmount = receivableDebtAmount;
      entity.currentDebtAmount =
        entity.type === PartnerType.CUSTOMER
          ? receivableDebtAmount
          : payableDebtAmount;
    }
  }

  async validateBeforeCreate(
    data: DeepPartial<Partner>,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    if (!data.isOrganization) {
      delete data.contacts;
      delete data.representative;
    }

    if (data.type !== PartnerType.CUSTOMER) {
      data.gender = null;
      data.dob = null;
    }

    const { contacts } = data;

    const errors: IError[] = [];

    if (contacts) {
      errors.push(
        ...this.checkDuplicate(contacts, ["email", "phone"], "contacts"),
      );
    }

    if (errors.length > 0)
      throw new BadRequestError("Dữ liệu không hợp lệ", errors);
  }

  async validateBeforeUpdate(
    id: string,
    data: Partial<Partner>,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    if (data.isOrganization === false) {
      delete data.contacts;
      delete data.representative;
      data.representative = null;
      await this.partnerContactRepository
        .getRepository(manager)
        .createQueryBuilder()
        .delete()
        .from("partner_contacts")
        .where("partnerId = :partnerId", { partnerId: id })
        .execute();
    }

    if (data.gender !== undefined || data.dob !== undefined) {
      const existing = await this.repository.findById(id, manager);
      if (existing?.type !== PartnerType.CUSTOMER) {
        data.gender = null;
        data.dob = null;
      }
    }
  }
}
