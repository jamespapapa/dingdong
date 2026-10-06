import { z } from "zod";
export const reconciliationContract = {
  format: "json" as const,
  description:
    "Submit a JSON string with orderSource and receiptSource (source labels), orders [{lineId,sku,quantity,hold?}], and receipts [{lineId,sku,quantity}]. Order lineId values must be unique. Receipt rows with the same lineId are summed; SKU must agree. Quantities are integers from 0 to 1,000,000, at most 300 rows per list and 20,000 input characters. Rules are pinned in each reconcile step's content as JSON {excludeHeld:true,toleranceUnits:0}. Source labels are caller assertions, not verified external provenance.",
};
const label = z.string().trim().min(1).max(120);
const quantity = z.number().int().min(0).max(1000000);
export const reconciliationRules = z
  .object({
    excludeHeld: z.boolean().default(true),
    toleranceUnits: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
export const reconciliationInput = z
  .object({
    orderSource: z.string().trim().min(1).max(300),
    receiptSource: z.string().trim().min(1).max(300),
    orders: z
      .array(
        z
          .object({
            lineId: label,
            sku: label,
            quantity,
            hold: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(300),
    receipts: z
      .array(z.object({ lineId: label, sku: label, quantity }).strict())
      .max(300),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.orders.map((row) => row.lineId)).size !==
      value.orders.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["orders"],
        message:
          "발주 lineId가 중복됩니다. 각 발주 행에 고유한 ID를 사용해주세요.",
      });
  });
export const reconciliationExample = JSON.stringify(
  {
    orderSource: "합성 발주 자료",
    receiptSource: "합성 입고 자료",
    orders: [
      { lineId: "line-1", sku: "BOOK-A", quantity: 10 },
      { lineId: "line-2", sku: "BOX-B", quantity: 4, hold: true },
    ],
    receipts: [{ lineId: "line-1", sku: "BOOK-A", quantity: 8 }],
  },
  null,
  2,
);
