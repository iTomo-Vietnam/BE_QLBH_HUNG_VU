import { injectable, inject } from "inversify";
import { DeepPartial, EntityManager } from "typeorm";
import { BaseService } from "@/shared/base/BaseService";
import { PartnerContact } from "@/database/models";
import { BadRequestError } from "@/shared/types/errors";
import { RequestContext } from "@/shared/types/interfaces";
import { PARTNER_TYPES } from "../partner/partner.types";
import { PARTNER_CONTACT_TYPES } from "./partnerContact.types";
import { PartnerContactRepository } from "./partnerContact.repository";

/**
 * PartnerContact Service - Tenant Entity
 */
@injectable()
export class PartnerContactService extends BaseService<PartnerContact> {
  protected repository: PartnerContactRepository;
  protected uniqueFields: (keyof PartnerContact)[] = ["email", "phone"];
  protected uniqueScope: (keyof PartnerContact)[] = ["partnerId"];
  protected searchableFields = ["name", "phone", "email", "note"];

  constructor(
    @inject(PARTNER_CONTACT_TYPES.PartnerContactRepository)
    partnerContactRepository: PartnerContactRepository,
    @inject(PARTNER_TYPES.PartnerRepository)
    private partnerRepository: any,
  ) {
    super();
    this.repository = partnerContactRepository;
  }

  async validateBeforeCreate(
    data: DeepPartial<PartnerContact>,
    manager?: EntityManager,
    _req?: RequestContext,
  ): Promise<void> {
    if (!data.partnerId) return;
    const partner = await this.partnerRepository.findById(data.partnerId, manager);
    if (!partner?.isOrganization) {
      throw new BadRequestError("Người liên hệ chỉ được khai báo cho đơn vị tổ chức");
    }
  }

  async validateBeforeUpdate(
    id: string,
    data: DeepPartial<PartnerContact>,
    manager?: EntityManager,
    req?: RequestContext,
  ): Promise<void> {
    const contact = await this.getById(id, req, manager);
    const partner = contact?.partnerId
      ? await this.partnerRepository.findById(contact.partnerId, manager)
      : null;
    if (!partner?.isOrganization) {
      throw new BadRequestError("Người liên hệ chỉ được khai báo cho đơn vị tổ chức");
    }
  }
}
