/* Account security controls use the same origin/session and existing design system. */
/* global state */
async function accountSecurityPage() {
  document.querySelector('.sidebar')?.classList.remove('open');
  document.querySelector('#mobile-menu')?.setAttribute('aria-expanded', 'false');
  const root = document.querySelector('#content');
  const deliveryNotice =
    state.user.emailDeliveryEnabled === false
      ? '<p role="status">Envio de e-mail indisponível. Não há recuperação de senha por e-mail; guarde sua senha e os códigos de recuperação do autenticador.</p>'
      : '';
  root.innerHTML = `<section class="panel"><h1>Segurança e privacidade</h1><p>Exporte os dados da sua conta ou gerencie suas credenciais.</p><button class="button" id="export-account">Exportar meus dados</button><form id="account-password-form"><label>Senha atual<input name="currentPassword" type="password" required autocomplete="current-password"></label><label>Nova senha<input name="password" type="password" minlength="12" maxlength="200" required autocomplete="new-password"></label><label>Código do autenticador (se ativo)<input name="code" autocomplete="one-time-code" inputmode="numeric" maxlength="6"></label><label>Código de recuperação (alternativo)<input name="recoveryCode" autocomplete="off"></label><button class="button primary">Alterar senha e encerrar sessões</button></form><form id="account-privacy-form"><label>Confirme sua senha<input name="currentPassword" type="password" required autocomplete="current-password"></label><label>Código do autenticador (se ativo)<input name="code" autocomplete="one-time-code" inputmode="numeric" maxlength="6"></label><label>Código de recuperação (alternativo)<input name="recoveryCode" autocomplete="off"></label><button class="button">Solicitar exclusão de conta</button></form><p>Prontuários podem exigir retenção legal. A solicitação será registrada para avaliação.</p><p id="account-feedback" role="status" aria-live="polite"></p></section>`;
  root.insertAdjacentHTML(
    'beforeend',
    `<section class="panel"><h2>Autenticação em duas etapas</h2><p>Configure um aplicativo autenticador. Guarde os códigos de recuperação em local seguro.</p><form id="mfa-form"><label>Senha atual<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>Código do autenticador<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label><button type="button" class="button" id="mfa-setup">Configurar autenticador</button><button type="submit" class="button primary">Confirmar ativação</button><button type="button" class="button" id="mfa-disable">Desativar duas etapas</button></form><pre id="mfa-information" role="status" aria-live="polite"></pre></section>`,
  );
  root.insertAdjacentHTML('afterbegin', deliveryNotice);
  const mfaForm = document.querySelector('#mfa-form'),
    mfaInfo = document.querySelector('#mfa-information');
  const mfaData = () => Object.fromEntries(new FormData(mfaForm));
  document.querySelector('#mfa-setup').onclick = async () => {
    try {
      const result = await api('/api/account/mfa/setup', {
        method: 'POST',
        body: JSON.stringify(mfaData()),
      });
      mfaInfo.textContent =
        'Chave para adicionar manualmente ao autenticador: ' +
        result.secret +
        '\nConfirme com o código gerado para concluir.';
    } catch (error) {
      mfaInfo.textContent = error.message;
    }
  };
  mfaForm.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/account/mfa/confirm', {
        method: 'POST',
        body: JSON.stringify(mfaData()),
      });
      mfaInfo.textContent =
        'Ativado. Guarde os códigos abaixo; eles não serão exibidos novamente. Entre novamente na conta.\n' +
        result.recoveryCodes.join('\n');
    } catch (error) {
      mfaInfo.textContent = error.message;
    }
  };
  document.querySelector('#mfa-disable').onclick = async () => {
    if (!confirm('Desativar a autenticação em duas etapas e encerrar as sessões?')) return;
    try {
      await api('/api/account/mfa/disable', { method: 'POST', body: JSON.stringify(mfaData()) });
      mfaInfo.textContent = 'Desativado. Entre novamente.';
    } catch (error) {
      mfaInfo.textContent = error.message;
    }
  };
  const feedback = (message) => {
    document.querySelector('#account-feedback').textContent = message;
  };
  document.querySelector('#export-account').onclick = async () => {
    try {
      const data = await api('/api/account/export');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'nutritrack-meus-dados.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      feedback(error.message);
    }
  };
  for (const [id, route] of [
    ['account-password-form', '/api/account/password'],
    ['account-privacy-form', '/api/account/deletion-request'],
  ]) {
    document.getElementById(id).onsubmit = async (event) => {
      event.preventDefault();
      if (
        !confirm(
          id === 'account-password-form'
            ? 'Alterar a senha e encerrar todas as sessões?'
            : 'Registrar solicitação de exclusão?',
        )
      )
        return;
      const button = event.currentTarget.querySelector('button');
      button.disabled = true;
      try {
        const result = await api(route, {
          method: 'POST',
          body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
        });
        feedback(result.message || 'Senha alterada. Entre novamente.');
        if (id === 'account-password-form') setTimeout(() => location.reload(), 1000);
      } catch (error) {
        feedback(error.message);
      } finally {
        button.disabled = false;
      }
    };
  }
}
document.querySelector('#security-account').onclick = () => accountSecurityPage();
document.querySelector('#forgot-password').onclick = () => {
  openModal(
    'Recuperar acesso',
    'Informe o e-mail da conta verificada.',
    field('email', 'E-mail', 'email', { required: true }),
    'Enviar instruções',
    async (data) => {
      const result = await api('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      toast(result.message);
    },
  );
};
(async () => {
  const match = location.hash.match(/^#(verify-email|reset-password)=([a-f\d]{64})$/);
  if (!match) return;
  const [, kind, token] = match;
  history.replaceState(null, '', location.pathname);
  if (kind === 'verify-email') {
    openModal(
      'Confirmar e-mail',
      'Defina a senha que você deseja usar nesta conta.',
      field('password', 'Sua senha', 'password', { required: true }),
      'Confirmar endereço',
      async (data) => {
        await api('/api/auth/verification/complete', {
          method: 'POST',
          body: JSON.stringify({ ...data, token }),
        });
        toast('E-mail confirmado. Entre com sua senha.');
      },
    );
  } else
    openModal(
      'Criar nova senha',
      'Use uma senha de 12 a 200 caracteres.',
      field('password', 'Nova senha', 'password', { required: true }),
      'Salvar senha',
      async (data) => {
        await api('/api/auth/password-reset/complete', {
          method: 'POST',
          body: JSON.stringify({ ...data, token }),
        });
        toast('Senha redefinida. Entre novamente.');
      },
    );
})();
// Associate editor labels inserted dynamically and prevent accidental duplicate submission.
let labelCounter = 0;
new MutationObserver(() => {
  for (const label of document.querySelectorAll('label:not([for])')) {
    const control = label.nextElementSibling;
    if (control?.matches('input,select,textarea')) {
      control.id ||= `editor-control-${++labelCounter}`;
      label.htmlFor = control.id;
    }
  }
}).observe(document.body, { childList: true, subtree: true });
