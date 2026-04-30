import { test, expect } from "@playwright/test";

async function login(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("heading", { name: /Main Dashboard/i })).toBeVisible();
}

test("manager and commissioner navigation smoke", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: /My Team/i }).click();
  await expect(page.getByRole("heading", { name: /My Team/i })).toBeVisible();
  await page.getByRole("link", { name: /Players/i }).click();
  await expect(page.getByRole("heading", { name: /Players/i })).toBeVisible();
  await page.getByRole("link", { name: /Commissioner/i }).click();
  await expect(page.getByRole("heading", { name: /^Commissioner$/i })).toBeVisible();
  await expect(page.getByText(/Weekly Operations/i)).toBeVisible();
  await page.getByRole("link", { name: "Data" }).click();
  await expect(page.getByRole("heading", { name: "Data Quality" })).toBeVisible();
});

test("draft TV mode and rule settings render", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: /Draft/i }).click();
  await page.getByRole("button", { name: /TV Mode/i }).click();
  await expect(page.locator(".draft-tv-panel").getByText(/Recent picks/i)).toBeVisible();
  await page.getByRole("link", { name: /Commissioner/i }).click();
  await page.getByRole("link", { name: "Rules" }).click();
  await expect(page.getByText(/Waiver Mode/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "League Rules" })).toBeVisible();
});

test("mobile shell exposes navigation after login", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only project");
  await login(page);
  await expect(page.locator(".mobile-nav")).toBeVisible();
  await page.locator(".mobile-nav [data-view='league']").click();
  await expect(page).toHaveURL(/#\/league/);
  await expect(page.getByText(/Full league standings/i)).toBeVisible();
});
