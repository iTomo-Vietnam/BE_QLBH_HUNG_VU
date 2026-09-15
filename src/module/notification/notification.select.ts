import { FindOptionsSelect, FindOptionsRelations } from "typeorm";
import { BaseSelect, RelationSelectConfig } from "@/shared/base/BaseSelect";
import { Notification } from "@/database/models/Notification";

export const NotificationSelectFull: FindOptionsSelect<Notification> = {
  ...BaseSelect,
  userId: true,
  type: true,
  action: true,
  title: true,
  body: true,
  data: true,
  isRead: true,
  readAt: true,
  entityType: true,
  entityId: true,
};

export const NotificationSelectList: FindOptionsSelect<Notification> = {
  id: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
  type: true,
  action: true,
  title: true,
  body: true,
  data: true,
  isRead: true,
  entityType: true,
  entityId: true,
};

export const NotificationRelations: FindOptionsRelations<Notification> = {};

export const NotificationRelationsList: FindOptionsRelations<Notification> = {};

export const NotificationRelationSelects: RelationSelectConfig<Notification> =
  {};

export const NotificationRelationSelectsForList: RelationSelectConfig<Notification> =
  {};
