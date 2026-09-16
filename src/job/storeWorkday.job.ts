import { Cron } from "croner";
import { In, IsNull, LessThanOrEqual } from "typeorm";
import DatabaseConfig from "@/config/database";
import { container } from "@/config/container";
import {
  Store,
  Order,
  OrderStatus,
  OrderType,
  IncomeExpense,
  IncomeExpenseStatus,
  StoreTransfer,
} from "@/database/models";
import { StoreTransferStatus } from "@/database/models/StoreTransfer";
import { ORDER_TYPES } from "@/module/order/order.types";
import { OrderService } from "@/module/order/order.service";
import { INCOME_EXPENSE_TYPES } from "@/module/incomeExpense/incomeExpense.types";
import { IncomeExpenseService } from "@/module/incomeExpense/incomeExpense.service";
import { NOTIFICATION_TYPES } from "@/module/notification/notification.types";
import { NotificationService } from "@/module/notification/notification.service";
import { ActionType, NotificationType } from "@/database/models/Notification";
import logger from "@/shared/utils/logger";

const TIME_ZONE = "Asia/Ho_Chi_Minh";
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const orderTypes = [
  OrderType.SALE,
  OrderType.SALE_RETURN,
  OrderType.PURCHASE,
  OrderType.PURCHASE_RETURN,
];

const localFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const getLocalParts = (value: Date) => {
  const parts = Object.fromEntries(
    localFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
};

const getWallClock = (value: Date) => {
  const local = getLocalParts(value);
  return {
    local,
    value: Date.UTC(
      Number(local.date.slice(0, 4)),
      Number(local.date.slice(5, 7)) - 1,
      Number(local.date.slice(8, 10)),
      local.hour,
      local.minute,
    ),
  };
};

const parseEndTime = (date: string, value: string): number | null => {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]));
};

const countLabel: Record<OrderType, string> = {
  [OrderType.SALE]: "đơn bán",
  [OrderType.SALE_RETURN]: "đơn trả",
  [OrderType.PURCHASE]: "đơn nhập",
  [OrderType.PURCHASE_RETURN]: "đơn trả hàng nhập",
};

const getCountText = (counts: Partial<Record<OrderType | "incomeExpense", number>>) =>
  [
    ...orderTypes.map((type) => ({ label: countLabel[type], count: counts[type] || 0 })),
    { label: "phiếu thu chi", count: counts.incomeExpense || 0 },
  ]
    .filter((item) => item.count > 0)
    .map((item) => `${item.count} ${item.label}`)
    .join(", ");

const getRepositories = () => ({
  order: DatabaseConfig.getRepository(Order),
  incomeExpense: DatabaseConfig.getRepository(IncomeExpense),
  transfer: DatabaseConfig.getRepository(StoreTransfer),
});

async function notifyPendingTransfers(
  store: Store,
  date: string,
  endInstant: Date,
): Promise<void> {
  const { transfer } = getRepositories();
  const pending = await transfer.find({
    where: {
      toStoreId: store.id,
      status: StoreTransferStatus.EXPORTED,
      importedAt: null,
      exportedAt: LessThanOrEqual(endInstant),
      deletedAt: IsNull(),
    } as any,
  });
  if (!pending.length) return;

  const notificationService = container.get<NotificationService>(
    NOTIFICATION_TYPES.NotificationService,
  );
  const recipientIds = await notificationService.findUsersWithPermission(
    store.id,
    "storeTransfer",
    "complete",
  );
  if (!recipientIds.length) return;

  const codes = pending.map((item) => item.code).filter(Boolean);
  await notificationService.createNotificationByEntityOnce(
    {
      id: store.id,
      entityType: "Store",
      storeId: store.id,
      transferIds: pending.map((item) => item.id),
      transferCodes: codes,
      message: `Cửa hàng ${store.name} còn ${pending.length} phiếu chuyển hàng đã xuất nhưng chưa nhập kho: ${codes.join(", ")}`,
    },
    NotificationType.STORE_TRANSFER,
    ActionType.REMINDER,
    recipientIds,
    `unfinished-transfer:${store.id}:${date}`,
  );
}

async function notifyUnfinished(store: Store, date: string, counts: Partial<Record<OrderType | "incomeExpense", number>>): Promise<void> {
  const notificationService = container.get<NotificationService>(NOTIFICATION_TYPES.NotificationService);
  const permissions: Array<{ type: OrderType | "incomeExpense"; module: "sale" | "saleReturn" | "purchase" | "purchaseReturn" | "incomeExpense" }> = [
    { type: OrderType.SALE, module: "sale" },
    { type: OrderType.SALE_RETURN, module: "saleReturn" },
    { type: OrderType.PURCHASE, module: "purchase" },
    { type: OrderType.PURCHASE_RETURN, module: "purchaseReturn" },
    { type: "incomeExpense", module: "incomeExpense" },
  ];
  const recipientGroups = await Promise.all(
    permissions
      .filter((item) => (counts[item.type] || 0) > 0)
      .map((item) => notificationService.findUsersWithPermission(store.id, item.module, "complete")),
  );
  const recipientIds = [...new Set(recipientGroups.flat())];
  if (!recipientIds.length) return;

  const countText = getCountText(counts);
  await notificationService.createNotificationByEntityOnce(
    {
      id: store.id,
      entityType: "Store",
      storeId: store.id,
      storeName: store.name,
      storeCode: store.code,
      message: `Công việc chưa hoàn thành - Cửa hàng ${store.name}: Có ${countText} chưa xác nhận hoàn thành, hệ thống sẽ tự động hủy sau 1 giờ nữa nếu các phiếu không được cập nhật`,
    },
    NotificationType.STORE_WORKDAY,
    ActionType.REMINDER,
    recipientIds,
    `unfinished:${store.id}:${date}`,
  );
}

async function processStore(store: Store, now: Date): Promise<void> {
  if (!store.workEndTime) return;
  const wallNow = getWallClock(now);
  const todayEndAt = parseEndTime(wallNow.local.date, store.workEndTime);
  if (todayEndAt === null) return;
  // If today's closing time has not happened yet, process yesterday's
  // deadline so a restart cannot leave old drafts behind forever.
  const endAt = wallNow.value >= todayEndAt ? todayEndAt : todayEndAt - 24 * 60 * 60 * 1000;
  const endDate = new Date(endAt).toISOString().slice(0, 10);
  const endInstant = new Date(endAt - VIETNAM_OFFSET_MS);

  const { order, incomeExpense } = getRepositories();
  const draftWhere = {
    storeId: store.id,
    status: OrderStatus.DRAFT,
    type: In(orderTypes),
    createdAt: LessThanOrEqual(endInstant),
    deletedAt: IsNull(),
  } as any;
  const draftOrders = await order.find({ where: draftWhere });
  const draftIncomeExpenses = await incomeExpense.count({
    where: {
      storeId: store.id,
      status: IncomeExpenseStatus.DRAFT,
      createdAt: LessThanOrEqual(endInstant),
      deletedAt: IsNull(),
    } as any,
  });
  const counts = draftOrders.reduce<Partial<Record<OrderType | "incomeExpense", number>>>((result, item) => {
    result[item.type] = (result[item.type] || 0) + 1;
    return result;
  }, { incomeExpense: draftIncomeExpenses });

  const elapsed = wallNow.value - endAt;
  if (elapsed >= 0) {
    // Chỉ nhắc cửa hàng nhận. Phiếu chuyển kho không bị tự hủy ở job này.
    await notifyPendingTransfers(store, endDate, endInstant);
  }
  if (elapsed >= 0 && elapsed < 60 * 60 * 1000 && getCountText(counts)) {
    await notifyUnfinished(store, endDate, counts);
    return;
  }
  if (elapsed < 60 * 60 * 1000) return;

  // `endAt` is a local Vietnam wall-clock represented as UTC for comparison;
  // convert it back to the actual UTC instant before comparing DB timestamps.
  const cutoff = new Date(endAt + 60 * 60 * 1000 - VIETNAM_OFFSET_MS);
  const orderService = container.get<OrderService>(ORDER_TYPES.OrderService);
  const incomeExpenseService = container.get<IncomeExpenseService>(INCOME_EXPENSE_TYPES.Service);
  const cancellableOrders = draftOrders.filter((item) => item.createdAt <= cutoff);
  for (const item of cancellableOrders) {
    try {
      await orderService.cancelDraftForSystem(item.id, store.id);
    } catch (error) {
      logger.error(`[StoreWorkday] Không thể tự hủy đơn ${item.id}:`, error);
    }
  }
  await incomeExpenseService.cancelDraftsForSystem(store.id, cutoff);
}

let job: Cron | null = null;
let running = false;

export const StoreWorkdayJob = {
  start: () => {
    if (job) return;
    job = new Cron("0 * * * * *", { timezone: TIME_ZONE }, async () => {
      if (running) return;
      running = true;
      try {
        const stores = await DatabaseConfig.getRepository(Store).find({
          where: { isActive: true, deletedAt: IsNull() } as any,
        });
        for (const store of stores) await processStore(store, new Date());
      } catch (error) {
        logger.error("[StoreWorkday] Job thất bại:", error);
      } finally {
        running = false;
      }
    });
    logger.info("[StoreWorkday] Job đã được khởi động");
  },
  stop: () => {
    job?.stop();
    job = null;
    logger.info("[StoreWorkday] Job đã dừng");
  },
};
