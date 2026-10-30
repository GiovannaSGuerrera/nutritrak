const portalRoot = document.querySelector('#patient-portal');
const PORTAL_API_BASE = (window.NUTRITRACK_API_BASE || '').replace(/\/$/, '');
const portalEsc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
async function portalApi(url, options = {}) {
  const workspaceId = localStorage.getItem('nutritrack-workspace-id');
  const response = await fetch(`${PORTAL_API_BASE}${url}`, {
    ...options,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = Error(data.error || 'Não foi possível concluir a operação.');
    error.status = response.status;
    throw error;
  }
  return data;
}
function portalFrame(content) {
  document.title = 'NutriTrack — Espaço do paciente';
  portalRoot.innerHTML = `<header class="portal-top"><a class="portal-brand" href="/paciente"><span class="brand-mark">♧</span><span>NutriTrack<small>ESPAÇO DO PACIENTE</small></span></a></header><div class="portal-content">${content}</div>`;
  portalRoot.hidden = false;
  document.querySelector('#auth').hidden = true;
  document.querySelector('#app').hidden = true;
}
function portalLogin(error = '') {
  portalFrame(
    `<section class="auth-card portal-login-card"><p class="eyebrow">ACOMPANHAMENTO NUTRICIONAL</p><h1>Seu espaço de cuidado</h1><p class="muted">Entre para consultar os planos alimentares publicados para você.</p><form id="patient-login-form" autocomplete="off"><label>E-mail<input id="patient-login-email" name="patient-portal-email" type="email" required autocomplete="off" placeholder="voce@exemplo.com"></label><label>Senha<input id="patient-login-password" name="patient-portal-password" type="password" required autocomplete="new-password" placeholder="Sua senha"></label><button class="button primary full">Entrar no portal</button></form><p class="form-error" id="portal-error">${portalEsc(error)}</p><p class="portal-help">Ainda não tem acesso? Peça um convite ao seu profissional.</p><p class="auth-toggle"><a href="/">Acessar espaço profissional</a></p></section>`,
  );
  document.querySelector('#patient-login-form').onsubmit = async (event) => {
    event.preventDefault();
    const message = document.querySelector('#portal-error');
    message.textContent = '';
    try {
      const { portal } = await portalApi('/api/patient/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.querySelector('#patient-login-email').value,
          password: document.querySelector('#patient-login-password').value,
        }),
      });
      history.replaceState(null, '', '/paciente');
      renderPatientPortal(portal);
    } catch (error) {
      message.textContent = error.message;
    }
  };
}
function renderPatientPortal(portal) {
  portalFrame(
    `<section class="portal-welcome"><div><p class="eyebrow">SEU ACOMPANHAMENTO</p><h1>Olá, ${portalEsc(portal.patient.name)}</h1><p>Este é seu espaço privado com ${portalEsc(portal.professional.name)}.</p></div><div class="portal-actions"><button class="button" id="portal-refresh">Atualizar</button><button class="button" id="patient-logout">Sair</button></div></section><section class="portal-section"><div class="portal-section-head"><div><h2>Planos alimentares</h2><p>As versões publicadas pelo seu profissional aparecem aqui.</p></div><span class="portal-count">${portal.mealPlans.length} ${portal.mealPlans.length === 1 ? 'plano' : 'planos'}</span></div>${portal.mealPlans.length ? `<div class="portal-plan-list">${portal.mealPlans.map((plan) => `<article class="portal-plan"><header><div><span class="eyebrow">VERSÃO ${plan.version.number} · PUBLICADA ${portalEsc(new Date(plan.version.publishedAt).toLocaleDateString('pt-BR'))}</span><h3>${portalEsc(plan.name)}</h3></div><span class="plan-status published">Publicado</span></header>${plan.version.objective ? `<p class="portal-objective">${portalEsc(plan.version.objective)}</p>` : ''}${plan.version.startDate || plan.version.reviewDate ? `<p class="portal-dates">${plan.version.startDate ? `Início: ${portalEsc(new Date(plan.version.startDate + 'T12:00:00').toLocaleDateString('pt-BR'))}` : ''}${plan.version.reviewDate ? ` · Revisão: ${portalEsc(new Date(plan.version.reviewDate + 'T12:00:00').toLocaleDateString('pt-BR'))}` : ''}</p>` : ''}${plan.version.generalInstructions ? `<div class="portal-instructions"><strong>Orientações gerais</strong><p>${portalEsc(plan.version.generalInstructions)}</p></div>` : ''}<div class="portal-meals">${plan.version.meals.map((meal) => `<section class="portal-meal"><div class="portal-meal-head"><h4>${portalEsc(meal.name)}</h4>${meal.time ? `<span>${portalEsc(meal.time)}</span>` : ''}</div>${meal.instructions ? `<p class="portal-meal-note">${portalEsc(meal.instructions)}</p>` : ''}<ul>${meal.items.map((item) => `<li><span>${portalEsc(item.food)}</span><strong>${item.quantity === null ? '' : portalEsc(item.quantity)} ${portalEsc(item.unit)}</strong>${item.substitutions ? `<small>Substituições: ${portalEsc(item.substitutions)}</small>` : ''}</li>`).join('')}</ul></section>`).join('')}</div></article>`).join('')}</div>` : `<div class="portal-empty"><span class="portal-empty-mark">▤</span><h3>Ainda não há planos publicados</h3><p>Quando seu profissional publicar um plano para você, ele aparecerá nesta página.</p></div>`}</section><p class="portal-sync-note">Os dados são sincronizados com seu profissional. Atualize a página para buscar alterações recentes.</p>`,
  );
  document.querySelector('#portal-refresh').onclick = async () => {
    try {
      const { portal: next } = await portalApi('/api/patient/me');
      renderPatientPortal(next);
    } catch (error) {
      portalLogin(error.message);
    }
  };
  document.querySelector('#patient-logout').onclick = async () => {
    await portalApi('/api/patient/logout', { method: 'POST' });
    portalLogin();
  };
}
async function startPatientPortal() {
  if (!location.pathname.startsWith('/paciente')) return;
  portalRoot.hidden = false;
  document.querySelector('#auth').hidden = true;
  document.querySelector('#app').hidden = true;
  if (location.pathname === '/paciente/ativar') {
    const token = location.hash.slice(1);
    if (!token) {
      history.replaceState(null, '', '/paciente');
      portalLogin('Abra o link de convite enviado pelo seu profissional.');
      return;
    }
    try {
      const { invitation } = await portalApi('/api/patient/invitations/validate', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      portalFrame(
        `<section class="auth-card portal-login-card"><p class="eyebrow">CONVITE PARA O NUTRITRACK</p><h1>Ative seu acesso</h1><p class="muted">${portalEsc(invitation.professionalName)} convidou você para acessar seus planos publicados. Use o mesmo e-mail que foi cadastrado no seu perfil.</p><p class="portal-invite-name">Convite para <strong>${portalEsc(invitation.patientName)}</strong></p><form id="patient-activate-form" autocomplete="off"><label>E-mail<input id="patient-activate-email" name="patient-activation-email" type="email" required autocomplete="off" placeholder="voce@exemplo.com"></label><label>Crie uma senha<input id="patient-activate-password" name="patient-activation-password" type="password" required minlength="12" autocomplete="new-password" placeholder="Pelo menos 12 caracteres"></label><label>Confirme a senha<input id="patient-activate-confirm" name="patient-activation-confirm" type="password" required minlength="12" autocomplete="new-password" placeholder="Repita sua senha"></label><button class="button primary full">Ativar meu portal</button></form><p class="form-error" id="portal-error"></p></section>`,
      );
      document.querySelector('#patient-activate-form').onsubmit = async (event) => {
        event.preventDefault();
        const password = document.querySelector('#patient-activate-password').value;
        if (password !== document.querySelector('#patient-activate-confirm').value) {
          document.querySelector('#portal-error').textContent = 'As senhas não coincidem.';
          return;
        }
        try {
          const { portal } = await portalApi('/api/patient/activate', {
            method: 'POST',
            body: JSON.stringify({
              token,
              email: document.querySelector('#patient-activate-email').value,
              password,
            }),
          });
          history.replaceState(null, '', '/paciente');
          renderPatientPortal(portal);
        } catch (error) {
          document.querySelector('#portal-error').textContent = error.message;
        }
      };
    } catch (error) {
      history.replaceState(null, '', '/paciente');
      portalLogin(error.message);
    }
    return;
  }
  try {
    const { portal } = await portalApi('/api/patient/me');
    renderPatientPortal(portal);
  } catch (error) {
    if (error.status === 401) portalLogin();
    else portalLogin(error.message);
  }
}
async function createPatientInvitation(patientId, patientName) {
  const dialog = document.querySelector('#modal'),
    root = document.querySelector('#modal-content');
  root.innerHTML = `<h2>Convidar para o portal</h2><p class="modal-intro">O convite permite que ${portalEsc(patientName)} crie um acesso separado e consulte somente os planos publicados para este cadastro. O e-mail já deve estar cadastrado no perfil do paciente.</p><div class="portal-invite-loading"><span class="loading-dot"></span> Gerando convite de uso único…</div>`;
  dialog.showModal();
  try {
    const { token, expiresAt } = await portalApi(
      `/api/patients/${encodeURIComponent(patientId)}/invitations`,
      { method: 'POST', body: '{}' },
    );
    const link = `${location.origin}/paciente/ativar#${token}`;
    root.innerHTML = `<h2>Convite pronto</h2><p class="modal-intro">Copie o link e compartilhe diretamente com ${portalEsc(patientName)}. Ele só pode ser usado uma vez e expira em ${portalEsc(new Date(expiresAt).toLocaleString('pt-BR'))}.</p><label class="portal-link-label" for="patient-invite-link">Link de acesso</label><input class="portal-link-input" id="patient-invite-link" readonly value="${portalEsc(link)}"><div class="modal-actions"><button class="button" type="button" id="close-invite">Fechar</button><button class="button primary" type="button" id="copy-invite">Copiar convite</button></div><p class="form-error" id="invite-copy-status" role="status"></p>`;
    document.querySelector('#close-invite').onclick = () => dialog.close();
    document.querySelector('#copy-invite').onclick = async () => {
      const input = document.querySelector('#patient-invite-link');
      try {
        await navigator.clipboard.writeText(link);
        document.querySelector('#invite-copy-status').textContent = 'Link copiado.';
      } catch {
        input.select();
        document.querySelector('#invite-copy-status').textContent = 'Selecione e copie o link.';
      }
    };
  } catch (error) {
    root.innerHTML = `<h2>Não foi possível gerar o convite</h2><p class="modal-intro">${portalEsc(error.message)}</p><div class="modal-actions"><button class="button" type="button" id="close-invite">Fechar</button></div>`;
    document.querySelector('#close-invite').onclick = () => dialog.close();
  }
}
async function createPatientPasswordReset(patientId, patientName) {
  const dialog = document.querySelector('#modal'),
    root = document.querySelector('#modal-content');
  root.innerHTML = `<h2>Redefinir senha do portal</h2><p class="modal-intro">Será criado um link de uso único para ${portalEsc(patientName)}. O link expira em 24 horas e invalida sessões anteriores quando a nova senha for definida.</p><div class="portal-invite-loading"><span class="loading-dot"></span> Gerando link seguro…</div>`;
  dialog.showModal();
  try {
    const { token, expiresAt } = await portalApi(
      `/api/patients/${encodeURIComponent(patientId)}/password-resets`,
      { method: 'POST', body: '{}' },
    );
    const link = `${location.origin}/paciente/redefinir#${token}`;
    root.innerHTML = `<h2>Link de redefinição pronto</h2><p class="modal-intro">Compartilhe diretamente com ${portalEsc(patientName)}. O link expira em ${portalEsc(new Date(expiresAt).toLocaleString('pt-BR'))} e só pode ser usado uma vez.</p><label class="portal-link-label" for="patient-reset-link">Link seguro</label><input class="portal-link-input" id="patient-reset-link" readonly value="${portalEsc(link)}"><div class="modal-actions"><button class="button" type="button" id="close-reset">Fechar</button><button class="button primary" type="button" id="copy-reset">Copiar link</button></div><p class="form-error" id="reset-copy-status" role="status"></p>`;
    document.querySelector('#close-reset').onclick = () => dialog.close();
    document.querySelector('#copy-reset').onclick = async () => {
      const input = document.querySelector('#patient-reset-link');
      try {
        await navigator.clipboard.writeText(link);
        document.querySelector('#reset-copy-status').textContent = 'Link copiado.';
      } catch {
        input.select();
        document.querySelector('#reset-copy-status').textContent = 'Selecione e copie o link.';
      }
    };
  } catch (error) {
    root.innerHTML = `<h2>Não foi possível gerar o link</h2><p class="modal-intro">${portalEsc(error.message)}</p><div class="modal-actions"><button class="button" type="button" id="close-reset">Fechar</button></div>`;
    document.querySelector('#close-reset').onclick = () => dialog.close();
  }
}
const startPatientPortalWithReset = startPatientPortal;
startPatientPortal = async function () {
  if (location.pathname !== '/paciente/redefinir') return startPatientPortalWithReset();
  const token = location.hash.slice(1);
  if (!token) {
    history.replaceState(null, '', '/paciente');
    portalLogin('Abra o link seguro enviado pelo seu profissional.');
    return;
  }
  try {
    const { reset } = await portalApi('/api/patient/password-resets/validate', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    portalFrame(
      `<section class="auth-card portal-login-card"><p class="eyebrow">SEGURANÇA DO PORTAL</p><h1>Crie uma nova senha</h1><p class="muted">Defina uma nova senha para ${portalEsc(reset.patientName)}. Ela precisa ter pelo menos 12 caracteres.</p><form id="patient-reset-form" autocomplete="off"><label>Nova senha<input id="patient-reset-password" type="password" required minlength="12" autocomplete="new-password" placeholder="Pelo menos 12 caracteres"></label><label>Confirme a nova senha<input id="patient-reset-confirm" type="password" required minlength="12" autocomplete="new-password" placeholder="Repita sua senha"></label><button class="button primary full">Salvar nova senha</button></form><p class="form-error" id="portal-error"></p></section>`,
    );
    document.querySelector('#patient-reset-form').onsubmit = async (event) => {
      event.preventDefault();
      const password = document.querySelector('#patient-reset-password').value;
      if (password !== document.querySelector('#patient-reset-confirm').value) {
        document.querySelector('#portal-error').textContent = 'As senhas não coincidem.';
        return;
      }
      try {
        await portalApi('/api/patient/password-resets/complete', {
          method: 'POST',
          body: JSON.stringify({ token, password }),
        });
        history.replaceState(null, '', '/paciente');
        portalLogin('Senha redefinida. Entre com sua nova senha.');
      } catch (error) {
        document.querySelector('#portal-error').textContent = error.message;
      }
    };
  } catch (error) {
    history.replaceState(null, '', '/paciente');
    portalLogin(error.message);
  }
};
if (location.pathname.startsWith('/paciente')) startPatientPortal();
