import { test, expect } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";

test("OAuth hides project names until owner verification and grants only selected capabilities", async ({
  page,
  request,
}, info) => {
  const ownerKey = "synthetic-e2e-owner-key-at-least-32-characters";
  const ownerHeaders = { Authorization: `Bearer ${ownerKey}` };
  const project = await (
    await request.post("/api/tools/project_create", {
      headers: ownerHeaders,
      data: {
        input: { name: `공유 선택 검증 ${info.project.name}` },
        idempotencyKey: `consent-project-${info.project.name}`,
      },
    })
  ).json();
  const callback = "https://example.com/dingdong-test/oauth";
  // Intercept the synthetic redirect in the browser; no external account is used.
  await page.route(`${callback}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "Isolated OAuth callback",
    }),
  );
  const client = await (
    await request.post("/oauth/register", {
      data: {
        client_name: "Synthetic consent test",
        redirect_uris: [callback],
      },
    })
  ).json();
  const verifier = randomBytes(32).toString("base64url");
  await page.goto(
    `/oauth/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: "code", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" })}`,
  );
  await expect(page.getByText(project.name, { exact: true })).toHaveCount(0);
  await page.getByLabel("Dingdong 소유자 키").fill(ownerKey);
  await page.getByRole("button", { name: "소유자 확인", exact: true }).click();
  const selectedProject = page.getByRole("checkbox", {
    name: project.name,
    exact: true,
  });
  await expect(selectedProject).not.toBeChecked();
  await selectedProject.check();
  await page
    .getByRole("checkbox", { name: "기억 후보 제안", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "결과 본문 읽기", exact: true }),
  ).not.toBeChecked();
  expect(await page.content()).not.toContain(ownerKey);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "내 dots에 연결 허용" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    new RegExp("^https://example.com/dingdong-test/oauth\\?"),
  );
  const snapshot = await (
    await request.get("/api/snapshot", { headers: ownerHeaders })
  ).json();
  const grant = snapshot.connections.find(
    (c: any) => c.clientId === client.client_id,
  );
  expect(grant.projectIds).toEqual([project.id]);
  expect(grant.permissions).toEqual(["context:read", "memory:propose"]);
  expect(grant.allowProjectCreation).toBe(false);
  expect(grant.active).toBe(true);
});
