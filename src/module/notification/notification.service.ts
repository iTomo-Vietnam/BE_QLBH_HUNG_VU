import { injectable, inject } from "inversify";
import { BaseService } from "@/shared/base/BaseService";
import { NotificationRepository } from "./notification.repository";
import {
  ActionType,
  Notification,
  NotificationType,
} from "@/database/models/Notification";
import {
  NotificationRelations,
  NotificationSelectList,
} from "./notification.select";
import { SocketUtils } from "@/shared/utils/socket.utils";
import { getNotificationData } from "@/shared/utils/notification.utils";
import logger from "@/shared/utils/logger";
import { NOTIFICATION_TYPES } from "./notification.types";
import { Module } from "@/shared/middleware/permission.middleware";
import { EntityManager } from "typeorm";

@injectable()
export class NotificationService extends BaseService<Notification> {
  protected repository: NotificationRepository;
  protected findOptions = {};
  protected relations = NotificationRelations;
  protected selectedFields = NotificationSelectList;

  constructor(
    @inject(NOTIFICATION_TYPES.NotificationRepository)
    repository: NotificationRepository,
  ) {
    super();
    this.repository = repository;
  }

  /**
   * Tạo notification dựa trên entity và gửi đến các user liên quan.
   */
  async createNotificationByEntity(
    data: any,
    type: NotificationType,
    action: ActionType,
    userIds: string[] = [],
  ): Promise<void> {
    try {
      const notiData = getNotificationData(data, type, action);
      const title = notiData.title || "";
      const body =
        typeof data?.message === "string" && data.message.trim()
          ? data.message.trim()
          : this.interpolateTemplate(notiData.body || "", data);

      const notificationData: Partial<Notification> = {
        type,
        action,
        title,
        body,
        entityType: data?.entityType,
        entityId: data?.id,
        data: data,
      };

      await this.createNotification(notificationData, [...new Set(userIds)]);
    } catch (error) {
      logger.error("Error creating notification by entity:", error);
    }
  }

  /** Tạo thông báo một lần cho mỗi người nhận theo khóa nghiệp vụ. */
  async createNotificationByEntityOnce(
    data: any,
    type: NotificationType,
    action: ActionType,
    userIds: string[],
    dedupeKey: string,
  ): Promise<void> {
    const recipientIds = [...new Set(userIds.filter(Boolean))];
    if (!recipientIds.length) return;

    const existing = await this.repository
      .getRepository()
      .createQueryBuilder("notification")
      .select("notification.userId", "userId")
      .where("notification.type = :type", { type })
      .andWhere("notification.action = :action", { action })
      .andWhere("notification.data ->> 'dedupeKey' = :dedupeKey", { dedupeKey })
      .andWhere("notification.userId IN (:...recipientIds)", { recipientIds })
      .getRawMany();
    const existingIds = new Set(existing.map((item) => item.userId));
    const pendingIds = recipientIds.filter((id) => !existingIds.has(id));
    if (!pendingIds.length) return;

    await this.createNotificationByEntity(
      { ...data, dedupeKey },
      type,
      action,
      pendingIds,
    );
  }

  /**
   * Tạo 1 notification cho mỗi user (userId lưu trực tiếp trên Notification).
   */
  async createNotification(
    notificationData: Partial<Notification>,
    userIds: string[] = [],
    manager?: EntityManager,
  ): Promise<void> {
    try {
      if (userIds.length === 0) return;

      const repo = this.repository.getRepository(manager);

      // Tạo 1 notification cho mỗi user
      const entities = userIds.map((userId) =>
        repo.create({
          ...notificationData,
          userId,
          isRead: false,
        } as any),
      );
      await repo.save(entities as any);

      // Gửi socket real-time
      SocketUtils.sendSocketNotifications(
        userIds,
        "notification",
        notificationData as any,
      );
    } catch (error) {
      logger.error("Error creating notification:", error);
    }
  }

  /** Thay thế biến trong template: {code}, {customer}, {customerSnapshot.name}... */
  private interpolateTemplate(template: string, data: any): string {
    if (!template) return "";
    return template.replace(/\{(\w+(?:\.\w+)*)\}/g, (_, key: string) => {
      const keys = key.split(".");
      let val = data;
      for (const k of keys) {
        val = val?.[k];
      }
      return val != null ? String(val) : `{${key}}`;
    });
  }

  // Đếm số tin nhắn chưa đọc
  async countUnreadNotifications(userId: string): Promise<number> {
    return this.repository.count({ where: { userId, isRead: false } });
  }

  // Đánh dấu notification đã đọc
  async markAsRead(userId: string, notificationId: string): Promise<void> {
    await this.repository
      .getRepository()
      .createQueryBuilder()
      .update()
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where("id = :notificationId", { notificationId })
      .andWhere("userId = :userId", { userId })
      .execute();
  }

  // Đánh dấu nhiều notifications đã đọc
  async markManyAsRead(
    userId: string,
    notificationIds: string[],
  ): Promise<void> {
    if (notificationIds.length === 0) return;
    await this.repository
      .getRepository()
      .createQueryBuilder()
      .update()
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where("id IN (:...notificationIds)", { notificationIds })
      .andWhere("userId = :userId", { userId })
      .execute();
  }

  // Đánh dấu tất cả notifications của user đã đọc
  async markAllAsRead(userId: string): Promise<void> {
    await this.repository
      .getRepository()
      .update(
        { userId, isRead: false } as any,
        { isRead: true, readAt: new Date() } as any,
      );
  }

  // ======================== APPROVAL NOTIFICATION HELPERS ========================

  /**
   * Tìm tất cả userIds của người dùng trong một công ty có quyền cụ thể trên một module.
   */
  async findUsersWithPermission(
    storeId: string,
    module: Module,
    permission: string,
  ): Promise<string[]> {
    try {
      const rows = await this.repository.getRepository().manager.query(
        `
        SELECT DISTINCT su."userId"
        FROM store_users su
        INNER JOIN users u ON u.id = su."userId"
          AND u."deletedAt" IS NULL
          AND u."isActive" = true
        LEFT JOIN roles r ON r.id = su."roleId" AND r."deletedAt" IS NULL
        WHERE su."storeId" = $1
          AND su."deletedAt" IS NULL
          AND (
            u."username" = 'admin'
            OR (
              r.permissions->>$2 IS NOT NULL
              AND r.permissions->$2 ? $3
            )
          )
      `,
        [storeId, module, permission],
      );

      return (rows as any[]).map((r) => r.userId);
    } catch (error) {
      logger.error("Error finding users with permission:", error);
      return [];
    }
  }

  /**
   * Gửi thông báo "cần phê duyệt" đến tất cả người dùng có quyền approve trên module,
   * trừ chính người tạo phiếu.
   */
  async notifyApprovalPending(
    entity: {
      id: string;
      code: string;
      storeId?: string | null;
      creatorId?: string | null;
    },
    module: Module,
    notificationType: NotificationType,
  ): Promise<void> {
    try {
      const storeId = entity.storeId;
      if (!storeId) return;

      const userIds = await this.findUsersWithPermission(
        storeId,
        module,
        "approve",
      );

      const creatorId = entity.creatorId;
      const filteredUserIds = userIds.filter((uid) => uid !== creatorId);

      if (filteredUserIds.length === 0) return;

      await this.createNotificationByEntity(
        entity,
        notificationType,
        ActionType.PENDING,
        filteredUserIds,
      );
    } catch (error) {
      logger.error("Error sending approval pending notification:", error);
    }
  }

  /**
   * Gửi thông báo "đã được duyệt" đến người tạo phiếu và người phụ trách (staff),
   * trừ chính người phê duyệt.
   */
  async notifyApproved(
    entity: { id: string; code: string },
    module: Module,
    notificationType: NotificationType,
    creatorUserId?: string | null,
    staffUserId?: string | null,
    approverUserId?: string | null,
  ): Promise<void> {
    try {
      const userIds = new Set<string>();

      if (creatorUserId) userIds.add(creatorUserId);
      if (staffUserId) userIds.add(staffUserId);

      if (approverUserId) userIds.delete(approverUserId);

      const filteredUserIds = Array.from(userIds).filter(Boolean);

      if (filteredUserIds.length === 0) return;

      await this.createNotificationByEntity(
        entity,
        notificationType,
        ActionType.APPROVE,
        filteredUserIds,
      );
    } catch (error) {
      logger.error("Error sending approved notification:", error);
    }
  }

  /**
   * Gửi thông báo "bị từ chối" đến người tạo phiếu và người phụ trách (staff),
   * trừ chính người từ chối.
   */
  async notifyRejected(
    entity: { id: string; code: string },
    module: Module,
    notificationType: NotificationType,
    creatorUserId?: string | null,
    staffUserId?: string | null,
    rejectorUserId?: string | null,
  ): Promise<void> {
    try {
      const userIds = new Set<string>();

      if (creatorUserId) userIds.add(creatorUserId);
      if (staffUserId) userIds.add(staffUserId);

      if (rejectorUserId) userIds.delete(rejectorUserId);

      const filteredUserIds = Array.from(userIds).filter(Boolean);

      if (filteredUserIds.length === 0) return;

      await this.createNotificationByEntity(
        entity,
        notificationType,
        ActionType.REJECT,
        filteredUserIds,
      );
    } catch (error) {
      logger.error("Error sending rejected notification:", error);
    }
  }

  /**
   * Gửi thông báo đến người phụ trách (staff) của entity.
   * Tìm user được gắn với employee (staffId) trong company, có quyền read trên module.
   */
  async notifyUsersWithReadPermission(
    entity: {
      id: string;
      code: string;
      storeId?: string;
      staffId?: string | null;
    },
    module: Module,
    notificationType: NotificationType,
    action: ActionType,
    excludeUserId?: string | null,
  ): Promise<void> {
    try {
      const storeId = entity.storeId;
      if (!storeId) return;

      const staffId = entity.staffId;
      if (!staffId) return;

      const rows = await this.repository.getRepository().manager.query(
        `
        SELECT DISTINCT su."userId"
        FROM store_users su
        INNER JOIN roles r ON r.id = su."roleId" AND r."deletedAt" IS NULL
        WHERE su."storeId" = $1
          AND su."deletedAt" IS NULL
          AND r.permissions->>$2 IS NOT NULL
          AND r.permissions->$2 ? $3
      `,
        [storeId, module, "read"],
      );

      const userIds = (rows as any[]).map((r) => r.userId);

      const filteredUserIds = excludeUserId
        ? userIds.filter((uid) => uid !== excludeUserId)
        : userIds;

      if (filteredUserIds.length === 0) return;

      await this.createNotificationByEntity(
        entity,
        notificationType,
        action,
        filteredUserIds,
      );
    } catch (error) {
      logger.error("Error sending read permission notification:", error);
    }
  }
}
