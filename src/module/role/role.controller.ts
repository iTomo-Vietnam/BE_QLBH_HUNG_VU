import { inject, injectable } from "inversify";
import { Role } from "@/database/models/store/Role";
import { BaseController } from "@/shared/base/BaseController";
import { RoleService } from "./role.service";
import { ROLE_TYPES } from "./role.types";
@injectable()
export class RoleController extends BaseController<Role> {
  protected service: RoleService;
  constructor(@inject(ROLE_TYPES.Service) service: RoleService) {
    super();
    this.service = service;
  }
}
