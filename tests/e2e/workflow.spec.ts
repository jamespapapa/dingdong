import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

test("memory → setup → execution → review → improvement, with keyboard and responsive layout", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByLabel("소유자 키", { exact: true })
    .fill("synthetic-e2e-owner-key-at-least-32-characters");
  await page.getByRole("button", { name: "워크스페이스 열기" }).click();
  await page.getByRole("button", { name: "+ 새 프로젝트" }).click();
  await page
    .getByLabel("프로젝트 이름")
    .fill(`검증용 업무 ${info.project.name}`);
  await page
    .getByRole("button", { name: "프로젝트 만들기", exact: true })
    .click();
  await page.getByRole("button", { name: "기억 보관함" }).click();
  await page.getByRole("button", { name: "+ 기억 남기기" }).click();
  await page.getByLabel("제목", { exact: true }).fill("주간 보고 기준");
  await expect(page.getByLabel("기억의 역할")).toHaveValue("core");
  await page
    .getByLabel("기억할 내용")
    .fill("보고서는 한국어로 작성하고 다음 행동을 명시한다.");
  await page.getByLabel("출처 또는 확인 근거").fill("격리 E2E 검증 시나리오");
  await page.getByRole("button", { name: "확정하고 저장" }).click();
  await expect(
    page.getByRole("heading", { name: "주간 보고 기준" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "다음 일은," })).toBeVisible();
  await page.getByLabel("설정할 업무").fill("주간 프로젝트 보고");
  await page.getByRole("button", { name: "자동화 초안 만들기" }).click();
  await page
    .getByLabel("적용할 지침")
    .fill("확정한 기억을 근거와 함께 사용한다.");
  await page.getByRole("button", { name: "설계 저장", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "저장한 v1 실행" }),
  ).toBeVisible();
  await page
    .getByLabel("이번 실행 자료")
    .fill("이번 주 완료: 연결 설계. 다음 주: 실제 계정 확인.");
  await page.getByRole("button", { name: "실행하기" }).click();
  await expect(
    page.getByRole("button", { name: "검토 승인", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("pre").filter({ hasText: "보고서는 한국어" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "검토 승인", exact: true }).click();
  await page.getByRole("button", { name: "개선 기록 남기기" }).click();
  await page.getByLabel("관찰한 문제").fill("다음 행동의 담당자가 빠졌다.");
  await page
    .getByLabel("다음에는 바꿀 점")
    .fill("다음 행동마다 담당자를 함께 적는다.");
  await page
    .getByLabel("개선 여부를 확인할 기준")
    .fill("모든 다음 행동에 담당자 필드가 있다.");
  await page.getByRole("button", { name: "개선 후보로 저장" }).click();
  await page.getByRole("button", { name: "검토하고 다음 버전에 반영" }).click();
  await expect(page.getByText("v2에 반영", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "기억 보관함" }).click();
  await expect(
    page.getByText("다음 행동마다 담당자를 함께 적는다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+ 기억 남기기" }).click();
  await page.getByLabel("기억의 역할").selectOption("episode");
  await page.getByLabel("제목", { exact: true }).fill("오늘의 검토 기록");
  await page
    .getByLabel("기억할 내용")
    .fill("보고서 검토를 마쳤고 다음 업무는 담당자 확인이다.");
  await page.getByRole("button", { name: "확정하고 저장" }).click();
  await expect(
    page.getByText("사실 · 작업 기록", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "+ 기억 남기기" }),
  ).toBeFocused();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  expect(overflow).toBe(false);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BODY",
  );
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({
    path: `artifacts/memory-${info.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "워크스페이스", exact: false })
    .first()
    .click();
  await page.screenshot({
    path: `artifacts/workspace-${info.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "dots 연결", exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "dots의 기억을 연결하세요." }),
  ).toBeVisible();
});
