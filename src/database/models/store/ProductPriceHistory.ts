import { Entity, Column, ManyToOne, JoinColumn } from "typeorm";
import { BaseNumericColumnOptions } from "@/shared/base/BaseEntity";
import { Product, ProductSnapshot } from "../Product";
import { StoreEntity } from "./StoreEntity";
import { OrderLine } from "./OrderLine";

@Entity("product_price_histories")
export class ProductPriceHistory extends StoreEntity {
  @Column({ type: "varchar", length: 20 })
  code: string; // mã phiếu
  @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  occurredAt: Date; // ngày thay đổi giá

  @Column({ type: "uuid" })
  productId: string;
  @ManyToOne(() => Product, (p) => p.priceHistories, { onDelete: "CASCADE" })
  @JoinColumn({ name: "productId" })
  product: Product;

  /** Chỉ có lịch sử giá vốn tự sinh từ một dòng nhập hàng mới có giá trị này. */
  @Column({ type: "uuid", nullable: true, default: null })
  purchaseLineId: string | null;
  @ManyToOne(() => OrderLine, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "purchaseLineId" })
  purchaseLine: OrderLine | null;

  @Column({ type: "jsonb", nullable: true, default: null })
  productSnapshot: ProductSnapshot | null;

  @Column(BaseNumericColumnOptions)
  costPrice: number; // Giá vốn/ĐVT cơ bản

  @Column(BaseNumericColumnOptions)
  deltaCostPrice: number; // = costPrice - costPriceBefore, có dấu: +tăng, -giảm
}
