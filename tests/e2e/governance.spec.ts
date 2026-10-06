import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { reconciliationExample } from "../../shared/reconciliation.ts";

test("versioned criteria, deterministic reconciliation, memory conflict resolution and proposal review", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByLabel("소유자 키", { exact: true })
    .fill("synthetic-e2e-owner-key-at-least-32-characters");
  await page.getByRole("button", { name: "워크스페이스 열기" }).click();
  await page.getByRole("button", { name: "+ 새 프로젝트" }).click();
  await page.getByLabel("프로젝트 이름").fill(`기준 검증 ${info.project.name}`);
  await page
    .getByRole("button", { name: "프로젝트 만들기", exact: true })
    .click();
  await page.getByRole("button", { name: "업무 기준과 검토" }).click();
  await page
    .getByLabel("공통 지침 이름")
    .fill(`원본 대조 기준 ${info.project.name}`);
  await page
    .getByLabel("지침 내용")
    .fill("차이 나는 행만 보고하고 원본 위치를 함께 적는다.");
  await page
    .getByRole("button", { name: "공통 지침 만들기", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: `원본 대조 기준 ${info.project.name}` })
    .check();
  await page.getByRole("button", { name: "선택한 최신 버전 연결" }).click();
  await expect(page.getByText("현재 연결: v1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "자동화 빌더" }).click();
  await page.getByRole("button", { name: "발주·입고 대조 만들기" }).click();
  await page.getByRole("button", { name: "설계 저장", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "저장한 v1 실행" }),
  ).toBeVisible();
  await page.getByLabel("이번 실행 자료").fill(reconciliationExample);
  await page.getByRole("button", { name: "실행하기" }).click();
  await expect(
    page.locator("pre").filter({ hasText: "차이/예외 1행" }),
  ).toBeVisible();
  await page.getByText("실행 기준과 입력 근거", { exact: true }).click();
  await expect(
    page.getByText(`원본 대조 기준 ${info.project.name} · v1`, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "검토 승인", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "개선 기록 남기기" }),
  ).toBeVisible();
  const url = new URL(page.url()),
    projectId = url.searchParams.get("project")!;
  const post = async (operation: string, input: any) => {
    const response = await page.request.post(`/api/tools/${operation}`, {
      headers: {
        Authorization: "Bearer synthetic-e2e-owner-key-at-least-32-characters",
      },
      data: { input, idempotencyKey: `fixture-${crypto.randomUUID()}` },
    });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  for (const [title, content] of [
    ["보류 원칙 A", "보류 발주를 제외한다."],
    ["보류 원칙 B", "보류 발주를 포함한다."],
  ])
    await post("memory_write", {
      projectId,
      title,
      content,
      kind: "decision",
      claimKey: "orders.hold",
      source: "격리 UI 테스트 자료",
      status: "confirmed",
    });
  await page.getByRole("button", { name: "업무 기준과 검토" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "orders.hold" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "이 근거로 확정" }).first().click();
  await expect(
    page.getByText("해결되지 않은 명시적 충돌이 없습니다."),
  ).toBeVisible();
  const workflows = await post("workflow_list", { projectId });
  const w = workflows.workflows[0];
  await post("workflow_propose", {
    id: w.id,
    revision: w.revision,
    reason: "원본 근거를 대조한 뒤 검토 기준 보강",
    workflow: {
      projectId,
      title: "개선한 발주 대조",
      brief: w.brief,
      requirements: "원본 위치와 담당자를 함께 적는다.",
      cadence: "manual",
      defaultInput: "",
      steps: w.steps,
    },
  });
  await page.reload();
  await page.getByText(/변경 내용 .*개 비교/).click();
  await expect(
    page.getByText("원본 위치와 담당자를 함께 적는다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "변경안 적용", exact: true }).click();
  await expect(
    page.getByText("개선한 발주 대조 · v2에 반영", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "선택한 최신 버전 연결" }).focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BODY",
  );
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({
    path: `artifacts/governance-${info.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
});
