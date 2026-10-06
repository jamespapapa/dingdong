import {
  reconciliationInput,
  reconciliationRules,
} from "../shared/reconciliation.ts";
import { AppError } from "./errors.ts";
const cell = (text: string) =>
  text.replace(/[\r\n]+/g, " ").replaceAll("|", "\\|");
export function parseRules(content: string) {
  try {
    return reconciliationRules.parse(content.trim() ? JSON.parse(content) : {});
  } catch {
    throw new AppError(
      400,
      '대조 규칙은 {"excludeHeld":true,"toleranceUnits":0} 형식이어야 합니다.',
    );
  }
}
export function reconcile(input: string, content: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new AppError(400, "발주·입고 자료는 JSON 형식이어야 합니다.");
  }
  const data = reconciliationInput.parse(parsed),
    rules = parseRules(content);
  const orders = new Map(
    data.orders.map((row, index) => [row.lineId, { ...row, index }]),
  );
  const received = new Map<
    string,
    { sku: string; quantity: number; indices: number[] }
  >();
  data.receipts.forEach((row, index) => {
    const previous = received.get(row.lineId),
      order = orders.get(row.lineId);
    if (
      (previous && previous.sku !== row.sku) ||
      (order && order.sku !== row.sku)
    )
      throw new AppError(
        400,
        `입고 ${index + 1}행의 상품 코드가 같은 발주 행과 다릅니다.`,
      );
    received.set(row.lineId, {
      sku: row.sku,
      quantity: (previous?.quantity || 0) + row.quantity,
      indices: [...(previous?.indices || []), index],
    });
  });
  let matched = 0,
    excluded = 0;
  const rows: {
    lineId: string;
    sku: string;
    expected: number;
    received: number;
    difference: number;
    status: string;
    evidence: string;
  }[] = [];
  for (const order of orders.values()) {
    const receipt = received.get(order.lineId),
      actual = receipt?.quantity || 0;
    received.delete(order.lineId);
    if (rules.excludeHeld && order.hold) {
      excluded++;
      continue;
    }
    const difference = actual - order.quantity;
    if (Math.abs(difference) <= rules.toleranceUnits) {
      matched++;
      continue;
    }
    rows.push({
      lineId: order.lineId,
      sku: order.sku,
      expected: order.quantity,
      received: actual,
      difference,
      status: difference < 0 ? "부족" : "초과",
      evidence: `orders[${order.index}]; ${receipt ? receipt.indices.map((i) => `receipts[${i}]`).join(", ") : "해당 입고 없음"}`,
    });
  }
  for (const [lineId, receipt] of received)
    rows.push({
      lineId,
      sku: receipt.sku,
      expected: 0,
      received: receipt.quantity,
      difference: receipt.quantity,
      status: "미등록 발주",
      evidence: receipt.indices.map((i) => `receipts[${i}]`).join(", "),
    });
  return `# 발주·입고 대조 결과\n\n일치 ${matched}행 · 차이/예외 ${rows.length}행 · 보류 제외 ${excluded}행\n\n발주 출처: ${cell(data.orderSource)}\n입고 출처: ${cell(data.receiptSource)}\n적용 규칙: 보류 제외 ${rules.excludeHeld ? "예" : "아니오"}, 허용 차이 ${rules.toleranceUnits}개\n\n${rows.length ? "| 발주 행 | 상품 | 발주 | 입고 | 차이 | 상태 | 원본 위치 |\n| --- | --- | ---: | ---: | ---: | --- | --- |\n" + rows.map((r) => `| ${cell(r.lineId)} | ${cell(r.sku)} | ${r.expected} | ${r.received} | ${r.difference} | ${r.status} | ${r.evidence} |`).join("\n") : "차이와 예외가 없습니다."}\n\n제출된 JSON을 정수 수량으로 계산했습니다. 출처 이름은 제출자가 제공했으며 외부 원본의 진위 확인을 뜻하지 않습니다.\n`;
}
