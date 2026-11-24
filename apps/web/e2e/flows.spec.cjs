const { test, expect } = require('@playwright/test');
const { AxeBuilder } = require('@axe-core/playwright');
for (const width of [1440, 1024, 768, 390])
  test(`cadastro, paciente, plano preservado e conta ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [],
      csp = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/Content Security Policy|violates.*style-src/i.test(message.text()))
        csp.push(message.text());
    });
    await page.goto('/');
    await expect(page.locator('#auth-second-factor')).toBeHidden();
    for (const line of await page.locator('.auth-intro-title span').all()) {
      expect(
        await line.evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBeTruthy();
    }
    await expect(page.getByText('Dados persistidos localmente', { exact: false })).toHaveCount(0);
    await page.screenshot({ path: `.tmp-pg-check/login-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await page.getByLabel('Seu nome').fill('Synthetic browser');
    await page.getByLabel('E-mail', { exact: true }).fill(`browser-${Date.now()}@example.invalid`);
    await page.getByLabel('Senha', { exact: true }).fill('Synthetic-password-123!');
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await page
      .getByRole('button', { name: width < 600 ? 'Cadastrar' : 'Novo paciente', exact: true })
      .click();
    await page.getByLabel('Nome completo').fill('Paciente sintético');
    await page.getByRole('button', { name: 'Salvar paciente', exact: true }).click();
    if (width < 600) await page.locator('#mobile-menu').click();
    await page.locator('[data-page="meal-plans"]').click();
    await page.getByRole('button', { name: '＋ Novo plano', exact: true }).click();
    await page.getByLabel('Nome do plano', { exact: true }).fill('Plano preservado');
    await page.getByLabel('Objetivo do plano', { exact: true }).fill('Objetivo preservado');
    await page.getByLabel('Nome da refeição', { exact: true }).fill('Café');
    await page.getByRole('button', { name: '＋ Adicionar alimento', exact: true }).click();
    await page.getByLabel('Alimento ou preparação').fill('Aveia');
    await page.getByLabel('Quantidade', { exact: true }).fill('40');
    await page.getByLabel('Unidade', { exact: true }).fill('g');
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
    await page.getByRole('button', { name: 'Editar rascunho', exact: true }).click();
    await expect(page.getByLabel('Nome do plano', { exact: true })).toHaveValue('Plano preservado');
    await expect(page.getByLabel('Objetivo do plano', { exact: true })).toHaveValue(
      'Objetivo preservado',
    );
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
    await page.getByRole('button', { name: 'Publicar plano', exact: true }).click();
    await expect(page.getByRole('button', { name: '＋ Nova versão', exact: true })).toBeVisible();
    if (width < 600) await page.locator('#mobile-menu').click();
    await page.locator('#security-account').click();
    await expect(page.getByRole('heading', { name: 'Segurança e privacidade' })).toBeVisible();
    await expect(page.locator('#account-password-form input[name="code"]')).toHaveCount(0);
    await expect(page.locator('#mfa-form')).toBeHidden();
    await page.screenshot({ path: `.tmp-pg-check/security-${width}.png`, fullPage: true });
    const issues = (await new AxeBuilder({ page }).analyze()).violations.filter((x) =>
      ['critical', 'serious'].includes(x.impact),
    );
    expect(issues.map((x) => ({ id: x.id, nodes: x.nodes.map((n) => n.target) }))).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy();
    expect(errors).toEqual([]);
    expect(csp).toEqual([]);
  });
