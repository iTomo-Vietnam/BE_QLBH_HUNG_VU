import { ContainerModule } from "inversify";
import { STORE_TRANSFER_TYPES } from "./storeTransfer.types";
import { StoreTransferRepository } from "./storeTransfer.repository";
import { StoreTransferService } from "./storeTransfer.service";
import { StoreTransferController } from "./storeTransfer.controller";
import { StoreTransferRouter } from "./storeTransfer.route";
import { INVENTORY_TYPES } from "../inventory/inventory.types";
import { StoreTransferLineRepository } from "./storeTransferLine.repository";
import { PRODUCT_TYPES } from "../product/product.types";
import { ATTRIBUTE_TYPES } from "../attribute/attribute.types";
import { STORE_TYPES } from "../store/store.types";
import { NOTIFICATION_TYPES } from "../notification/notification.types";

export const storeTransferModule = new ContainerModule((bind) => {
  bind(STORE_TRANSFER_TYPES.Repository).to(StoreTransferRepository).inSingletonScope();
  bind(STORE_TRANSFER_TYPES.LineRepository).to(StoreTransferLineRepository).inSingletonScope();
  bind(STORE_TRANSFER_TYPES.Service)
    .toDynamicValue((context) => new StoreTransferService(
      context.container.get(STORE_TRANSFER_TYPES.Repository),
      context.container.get(STORE_TRANSFER_TYPES.LineRepository),
      context.container.get(PRODUCT_TYPES.ProductRepository),
      context.container.get(ATTRIBUTE_TYPES.AttributeRepository),
      context.container.get(STORE_TYPES.StoreRepository),
      context.container.get(INVENTORY_TYPES.InventoryRecalculateService),
      context.container.get(NOTIFICATION_TYPES.NotificationService),
    ))
    .inSingletonScope();
  bind(STORE_TRANSFER_TYPES.Controller)
    .toDynamicValue((context) => new StoreTransferController(
      context.container.get(STORE_TRANSFER_TYPES.Service),
    ))
    .inSingletonScope();
  bind(STORE_TRANSFER_TYPES.Router)
    .toDynamicValue((context) => new StoreTransferRouter(
      context.container.get(STORE_TRANSFER_TYPES.Controller),
    ))
    .inSingletonScope();
});
