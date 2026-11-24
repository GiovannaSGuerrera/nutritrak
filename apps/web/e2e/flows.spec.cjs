const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
let child, directory, base;
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.resolve('.hardening-browser-'));
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['apps/api/src/server.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      STORE_BACKEND: 'sqlite',
      NUTRITRACK_CLINIC_ADMIN_ENABLED: 'false',
      DATA_DIR: directory,
      PORT: String(port),
      HOST: '127.0.0.1',
      PUBLIC_ORIGIN: base,
      CORS_ORIGINS: base,
    },
    stdio: 'ignore',
  });
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(base + '/ready')).ok) return;
    } catch {
      /* Startup polling. */
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('Browser test server did not start');
});
test.afterAll(async () => {
  if (child?.exitCode === null) {
    const stopped = new Promise((r) => child.once('exit', r));
    child.kill();
    await stopped;
  }
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`onboarding, patient form, goals and account controls ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        window.cspViolations.push(e.violatedDirective),
      );
    });
    await page.goto(base);
    await page.locator('#auth-toggle').click();
    await page.locator('#auth-name').fill('Synthetic Nutritionist');
    await page.locator('#auth-email').fill(crypto.randomUUID() + '@example.invalid');
    await page.locator('#auth-password').fill('synthetic-browser-password');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#content')).toContainText('Visão geral');
    await page.locator('#quick-patient').click();
    await page.getByLabel('Nome completo', { exact: true }).fill('Synthetic Patient');
    await page
      .getByLabel('E-mail', { exact: true })
      .last()
      .fill(crypto.randomUUID() + '@example.invalid');
    await page.getByRole('button', { name: 'Salvar paciente', exact: true }).click();
    await expect(page.locator('#modal')).not.toBeVisible();
    await expect(page.locator('#content')).toContainText('1');
    if (viewport.width < 650) await page.locator('#mobile-menu').click();
    await page.getByRole('button', { name: 'Metas', exact: true }).click();
    await expect(page.locator('#content')).toContainText('Nenhuma meta cadastrada');
    await page.getByRole('button', { name: 'Nova meta', exact: false }).first().click();
    await page.getByLabel('Descrição da meta', { exact: true }).fill('Synthetic hydration goal');
    await page.getByRole('button', { name: 'Criar meta', exact: true }).click();
    await expect(page.locator('#content')).toContainText('Synthetic hydration goal');
    if (viewport.width < 650) await page.locator('#mobile-menu').click();
    await page.locator('[data-page="meal-plans"]').click();
    await page.locator('#new-plan').click();
    await page.locator('#plan-form [name="name"]').fill('Synthetic nutrition plan');
    await page.locator('#plan-form [name="objective"]').fill('Synthetic preserved objective');
    await page.locator('.meal-name').fill('Lunch');
    await page.locator('.add-food').first().click();
    await page.locator('.food-name').fill('Rice');
    await page.locator('.food-quantity').fill('1');
    await page.locator('.food-unit').fill('portion');
    await page.getByRole('button',{name:'Salvar rascunho',exact:true}).click();
    await expect(page.locator('#modal')).not.toBeVisible();
    await page.locator('[data-edit-plan]').first().click();
    await expect(page.locator('#plan-form [name="name"]')).toHaveValue('Synthetic nutrition plan');
    await expect(page.locator('#plan-form [name="objective"]')).toHaveValue('Synthetic preserved objective');
    await page.locator('#cancel-plan').click();
    await page.locator('[data-publish-plan]').first().click();
    await expect(page.locator('#content .plan-status')).toContainText('Publicado');
    if(viewport.width<650)await page.locator('#mobile-menu').click();
    await page.locator('#security-account').click();
    await expect(page.getByRole('heading', { name: 'Segurança e privacidade' })).toBeVisible();
    await expect(
      page.locator('#account-password-form').getByLabel('Senha atual', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
    ).toBeTruthy();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(errors).toEqual([]);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations
        .filter((v) => ['critical', 'serious'].includes(v.impact))
        .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  });
}
