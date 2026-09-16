import { ActionType, NotificationType } from "@/database/models/Notification";

type NotificationContentKey = `${NotificationType}.${ActionType}`;

type NotificationContent = {
  [key in NotificationContentKey]?: string;
};

export const NotificationTitleMap: Record<
  NotificationType,
  Partial<Record<ActionType, string>>
> = {
  [NotificationType.SYSTEM]: {},
  [NotificationType.USER]: {},
  [NotificationType.ORDER]: {
    [ActionType.PENDING]: "Phiếu cần hoàn thành",
  },
  [NotificationType.ORDER_LINE]: {
    [ActionType.DAILY_WARNING]: "Đến ngày chạy máy",
  },
  [NotificationType.PRODUCTION]: {
    [ActionType.DAILY_WARNING]: "Đến hạn hoàn thành",
    [ActionType.FAILED]: "Quá hạn hoàn thành",
  },
  [NotificationType.STOCK_DOCUMENT]: {
    [ActionType.CREATE]: "Phiếu nhập/xuất kho mới",
  },
  // Approval modules
  [NotificationType.QUOTATION_REQUEST]: {
    [ActionType.PENDING]: "Đề nghị báo giá cần phê duyệt",
    [ActionType.APPROVE]: "Đề nghị báo giá đã được duyệt",
    [ActionType.REJECT]: "Đề nghị báo giá bị từ chối",
  },
  [NotificationType.QUOTATION]: {
    [ActionType.PENDING]: "Báo giá cần phê duyệt",
    [ActionType.APPROVE]: "Báo giá đã được duyệt",
    [ActionType.REJECT]: "Báo giá bị từ chối",
  },
  [NotificationType.PURCHASE_REQUISITION]: {
    [ActionType.PENDING]: "Đề nghị mua vật tư cần phê duyệt",
    [ActionType.APPROVE]: "Đề nghị mua vật tư đã được duyệt",
    [ActionType.REJECT]: "Đề nghị mua vật tư bị từ chối",
  },
  [NotificationType.PURCHASE_QUOTATION]: {
    [ActionType.PENDING]: "Báo giá mua cần phê duyệt",
    [ActionType.APPROVE]: "Báo giá mua đã được duyệt",
    [ActionType.REJECT]: "Báo giá mua bị từ chối",
  },
  [NotificationType.PURCHASE]: {
    [ActionType.PENDING]: "Đơn mua hàng cần phê duyệt",
    [ActionType.APPROVE]: "Đơn mua hàng đã được duyệt",
    [ActionType.REJECT]: "Đơn mua hàng bị từ chối",
  },
  [NotificationType.SHIPPING_PLAN]: {
    [ActionType.PENDING]: "Phương án vận chuyển cần phê duyệt",
    [ActionType.APPROVE]: "Phương án vận chuyển đã được duyệt",
    [ActionType.REJECT]: "Phương án vận chuyển bị từ chối",
  },
  [NotificationType.PAYMENT_REQUEST]: {
    [ActionType.PENDING]: "Đề nghị thanh toán cần phê duyệt",
    [ActionType.APPROVE]: "Đề nghị thanh toán đã được duyệt",
    [ActionType.REJECT]: "Đề nghị thanh toán bị từ chối",
  },
  [NotificationType.STORE_WORKDAY]: {
    [ActionType.REMINDER]: "Công việc chưa hoàn thành",
    [ActionType.CANCEL]: "Phiếu chưa hoàn thành đã bị hủy",
  },
  [NotificationType.STORE_TRANSFER]: {
    [ActionType.PENDING]: "Phiếu chuyển hàng cần xử lý",
    [ActionType.COMPLETE]: "Phiếu chuyển hàng đã xuất, chờ nhập kho",
  },
};

export const notificationContent: NotificationContent = {
  [`${NotificationType.PRODUCTION}.${ActionType.DAILY_WARNING}`]:
    "Lệnh sản xuất {code} sắp đến hạn ({remainingDays}) ngày",
  [`${NotificationType.PRODUCTION}.${ActionType.FAILED}`]:
    "Lệnh sản xuất {code} đã quá hạn hoàn thành ({remainingDays}) ngày",
  [`${NotificationType.ORDER_LINE}.${ActionType.DAILY_WARNING}`]:
    "SKU ({sku}) của đơn hàng {code} đã đến ngày chạy máy",
  [`${NotificationType.ORDER}.${ActionType.DAILY_WARNING}`]:
    "Đơn hàng {poCode} sắp đến hạn giao ({remainingDays} ngày)",
  [`${NotificationType.ORDER}.${ActionType.FAILED}`]:
    "Đơn hàng {poCode} đã quá hạn giao ({remainingDays} ngày)",
  [`${NotificationType.STOCK_DOCUMENT}.${ActionType.CREATE}`]:
    "Có một phiếu {kind} {toFrom} kho {warehouseName}, dự kiến {importExport} kho vào ngày {effectiveDate}",

  // ---- Approval notifications ----
  [`${NotificationType.QUOTATION_REQUEST}.${ActionType.PENDING}`]:
    "Bạn có một yêu cầu báo giá {code} cần phê duyệt",
  [`${NotificationType.QUOTATION_REQUEST}.${ActionType.APPROVE}`]:
    "Đề nghị báo giá {code} mà bạn tạo/phụ trách đã được duyệt",
  [`${NotificationType.QUOTATION_REQUEST}.${ActionType.REJECT}`]:
    "Đề nghị báo giá {code} mà bạn tạo/phụ trách đã bị từ chối",

  [`${NotificationType.QUOTATION}.${ActionType.PENDING}`]:
    "Bạn có một báo giá {code} cần phê duyệt",
  [`${NotificationType.QUOTATION}.${ActionType.APPROVE}`]:
    "Báo giá {code} mà bạn tạo/phụ trách đã được duyệt",
  [`${NotificationType.QUOTATION}.${ActionType.REJECT}`]:
    "Báo giá {code} mà bạn tạo/phụ trách đã bị từ chối",

  [`${NotificationType.PURCHASE_REQUISITION}.${ActionType.PENDING}`]:
    "Bạn có một đề nghị mua vật tư {code} cần phê duyệt",
  [`${NotificationType.PURCHASE_REQUISITION}.${ActionType.APPROVE}`]:
    "Đề nghị mua vật tư {code} mà bạn tạo/phụ trách đã được duyệt",
  [`${NotificationType.PURCHASE_REQUISITION}.${ActionType.REJECT}`]:
    "Đề nghị mua vật tư {code} mà bạn tạo/phụ trách đã bị từ chối",

  [`${NotificationType.PURCHASE_QUOTATION}.${ActionType.PENDING}`]:
    "Bạn có một báo giá mua {code} cần phê duyệt",
  [`${NotificationType.PURCHASE_QUOTATION}.${ActionType.APPROVE}`]:
    "Báo giá mua {code} mà bạn tạo/phụ trách đã được duyệt",
  [`${NotificationType.PURCHASE_QUOTATION}.${ActionType.REJECT}`]:
    "Báo giá mua {code} mà bạn tạo/phụ trách đã bị từ chối",

  [`${NotificationType.PURCHASE}.${ActionType.PENDING}`]:
    "Bạn có một đơn mua hàng {code} cần phê duyệt",
  [`${NotificationType.PURCHASE}.${ActionType.APPROVE}`]:
    "Đơn mua hàng {code} mà bạn tạo/phụ trách đã được duyệt",
  [`${NotificationType.PURCHASE}.${ActionType.REJECT}`]:
    "Đơn mua hàng {code} mà bạn tạo/phụ trách đã bị từ chối",

  [`${NotificationType.SHIPPING_PLAN}.${ActionType.PENDING}`]:
    "Bạn có một phương án vận chuyển {code} cần phê duyệt",
  [`${NotificationType.SHIPPING_PLAN}.${ActionType.APPROVE}`]:
    "Phương án vận chuyển {code} mà bạn tạo/phụ trách đã được duyệt",
  [`${NotificationType.SHIPPING_PLAN}.${ActionType.REJECT}`]:
    "Phương án vận chuyển {code} mà bạn tạo/phụ trách đã bị từ chối",

  [`${NotificationType.PAYMENT_REQUEST}.${ActionType.PENDING}`]:
    "Bạn có một đề nghị thanh toán {code} cần phê duyệt",
  [`${NotificationType.PAYMENT_REQUEST}.${ActionType.APPROVE}`]:
    "Đề nghị thanh toán {code} mà bạn tạo/phụ trách đã được duyệt",
  [`${NotificationType.PAYMENT_REQUEST}.${ActionType.REJECT}`]:
    "Đề nghị thanh toán {code} mà bạn tạo/phụ trách đã bị từ chối",
  [`${NotificationType.ORDER}.${ActionType.PENDING}`]:
    "Phiếu {code} cần được hoàn thành",
  [`${NotificationType.STORE_TRANSFER}.${ActionType.PENDING}`]:
    "Phiếu chuyển kho {code} đang chờ xuất kho",
  [`${NotificationType.STORE_TRANSFER}.${ActionType.COMPLETE}`]:
    "Phiếu chuyển kho {code} đã xuất, đang chờ nhập kho",
  [`${NotificationType.STORE_WORKDAY}.${ActionType.REMINDER}`]: "{message}",
  [`${NotificationType.STORE_WORKDAY}.${ActionType.CANCEL}`]: "{message}",
};
