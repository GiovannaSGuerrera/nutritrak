const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const API_BASE = (window.NUTRITRACK_API_BASE || '').replace(/\/$/, '');
const state = {
  user: null,
  page: 'dashboard',
  patients: [],
  appointments: [],
  patient: null,
  patientData: null,
  query: '',
  status: 'Todos',
  authMode: 'login',
  workspaces: [],
  workspaceId: '',
  activeExperience: '',
  activeRoles: [],
};
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const dateFmt = (s) =>
  s
    ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';
const timeFmt = (s) =>
  s ? new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
async function api(url, opts = {}) {
  const r = await fetch(`${API_BASE}${url}`, {
    ...opts,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(state.workspaceId ? { 'x-workspace-id': state.workspaceId } : {}),
      ...(opts.headers || {}),
    },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = Error(d.error || 'Não foi possível concluir a operação.');
    error.status = r.status;
    throw error;
  }
  return d;
}
function toast(msg, error = false) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
function heading(title, sub, button = '') {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div>${button}</div>`;
}
function openModal(title, intro, fields, submitText, handler) {
  const d = $('#modal'),
    root = $('#modal-content');
  root.innerHTML = `<h2>${title}</h2><p class="modal-intro">${intro}</p><form id="modal-form"><div class="form-grid">${fields}</div><div class="modal-actions"><button type="button" class="button" id="cancel-modal">Cancelar</button><button class="button primary">${submitText}</button></div></form>`;
  $('#cancel-modal').onclick = () => d.close();
  $('#modal-form').onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData);
    e.currentTarget.querySelectorAll('input[type="checkbox"][name]').forEach((input) => {
      const values = formData.getAll(input.name);
      data[input.name] = values.length > 1 ? values : values[0] || '';
    });
    e.currentTarget.querySelectorAll('select[multiple][name]').forEach((select) => {
      data[select.name] = formData.getAll(select.name);
    });
    try {
      await handler(data);
      d.close();
    } catch (err) {
      toast(err.message, true);
    }
  };
  d.showModal();
}
const field = (name, label, type = 'text', opts = {}) =>
  `<div class="field ${opts.wide ? 'wide' : ''}"><label>${label}</label>${type === 'textarea' ? `<textarea name="${name}" ${opts.required ? 'required' : ''} placeholder="${opts.placeholder || ''}"></textarea>` : type === 'select' ? `<select name="${name}" ${opts.required ? 'required' : ''}>${opts.options.map((x) => (typeof x === 'string' ? `<option>${x}</option>` : `<option value="${esc(x.value)}">${esc(x.label)}</option>`)).join('')}</select>` : `<input name="${name}" type="${type}" ${opts.required ? 'required' : ''} ${opts.min !== undefined ? `min="${opts.min}"` : ''} ${opts.step ? `step="${opts.step}"` : ''} ${opts.placeholder ? `placeholder="${opts.placeholder}"` : ''}>`}</div>`;
async function loadPatients() {
  state.patients = (await api('/api/patients')).patients;
  $('#patient-badge').textContent = state.patients.length;
}
async function navigate(page) {
  state.page = page;
  state.patient = null;
  $$('.nav-item').forEach((x) => x.classList.toggle('active', x.dataset.page === page));
  const label =
    {
      dashboard: 'Visão geral',
      patients: 'Pacientes',
      assessments: 'Avaliações',
      'meal-plans': 'Planos alimentares',
      agenda: 'Agenda',
      goals: 'Metas',
      team: 'Equipe',
      professionals: 'Profissionais',
      invitations: 'Convites',
      clinic: 'Clínica ou consultório',
      permissions: 'Permissões',
    }[page] || 'Visão geral';
  $('#crumb').textContent = label;
  $('#content').innerHTML = '<div class="empty-inline">Carregando…</div>';
  $('.sidebar').classList.remove('open');
  $('#mobile-menu').setAttribute('aria-expanded', 'false');
  try {
    if (page === 'dashboard') await dashboard();
    else if (page === 'patients') {
      await loadPatients();
      patientsPage();
    } else if (page === 'assessments') await assessmentsPage();
    else if (page === 'meal-plans') await mealPlansPage();
    else if (page === 'agenda') await agendaPage();
    else if (page === 'goals') await goalsPage();
    else if (page === 'team') await teamPage();
    else if (page === 'professionals') await professionalsPage();
    else if (page === 'invitations') await invitationsPage();
    else if (page === 'clinic') await clinicSettingsPage();
    else if (page === 'permissions') await permissionsPage();
  } catch (error) {
    const expired = error.status === 401;
    $('#content').innerHTML =
      `<section class="empty"><div class="empty-mark">!</div><h3>${expired ? 'Sua sessão expirou' : 'Não foi possível carregar esta seção'}</h3><p>${expired ? 'Entre novamente para continuar.' : esc(error.message || 'Verifique a conexão e tente de novo.')}</p><button class="button primary" id="retry-page">${expired ? 'Voltar para entrar' : 'Tentar novamente'}</button></section>`;
    $('#retry-page').onclick = () => (expired ? location.reload() : navigate(page));
  }
}
async function dashboard() {
  if (state.activeExperience === 'administrative') return clinicDashboard();
  const d = await api('/api/dashboard');
  const cards = [
    ['Pacientes cadastrados', d.patients, `${d.newThisMonth} novos neste mês`, '♧', 'mint'],
    ['Em acompanhamento', d.activePatients, 'Cadastros com status ativo', '♡', 'honey'],
    ['Avaliações registradas', d.totalAssessments, 'Histórico antropométrico salvo', '⌁', 'peach'],
    [
      'Sem primeira avaliação',
      d.activeWithoutAssessment,
      'Pacientes ativos sem medidas registradas',
      '▦',
      'mint',
    ],
  ];
  const chartEmpty =
    d.patients === 0
      ? 'O gráfico aparecerá com os primeiros cadastros'
      : 'Sem novos cadastros nos últimos seis meses';
  $('#content').innerHTML =
    `<div class="dashboard-heading"><div><p class="eyebrow">NUTRITRACK</p><h1>Visão geral</h1><p>Acompanhe pacientes, consultas e metas.</p></div><button class="button outline-button" data-go="patients">Ver pacientes <span>›</span></button></div><section class="stats">${cards.map((c) => `<article class="stat-card"><div class="stat-top">${c[0]}<span class="stat-icon ${c[4]}">${c[3]}</span></div><div class="stat-value">${c[1]}</div><div class="stat-hint">${c[2]}</div></article>`).join('')}</section><section class="panel chart-panel"><div class="panel-head"><div><h2>Novos pacientes</h2><p>Cadastros por mês, calculados do seu histórico</p></div><span class="period-pill">Últimos 6 meses</span></div>${d.newPatientsByMonth.some((m) => m.total > 0) ? newPatientsChart(d.newPatientsByMonth) : `<div class="chart-empty"><div class="chart-empty-icon">♧</div><strong>${chartEmpty}</strong><p>Os totais mensais são calculados a partir do histórico<br class="desktop-break"> de cadastros do seu consultório.</p></div>`}</section><div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Próximas consultas</h2><p>Consultas agendadas em breve</p></div><button class="text-action" data-go="agenda">Ver agenda →</button></div>${d.upcoming.length ? d.upcoming.map((a) => `<div class="appointment-row"><div class="time-block">${timeFmt(a.start)}</div><div><div class="row-primary">${esc(a.patientName)}</div><div class="row-secondary">${dateFmt(a.start)} · ${esc(a.type)}</div></div><span class="status-pill">Agendada</span></div>`).join('') : `<div class="empty-inline"><strong>Nenhuma consulta próxima</strong>Agendamentos futuros aparecerão aqui.</div>`}</section><section class="panel"><div class="panel-head"><div><h2>Atividade recente</h2><p>Movimentações do consultório</p></div></div>${d.recent.length ? d.recent.map((a) => `<div class="activity-row"><div class="avatar">${a.type === 'patient' ? '♧' : '•'}</div><div><div class="row-primary">${{ patient_created: 'Paciente cadastrado', patient_updated: 'Cadastro atualizado', patient_portal_activated: 'Portal do paciente ativado', assessment_created: 'Avaliação registrada', appointment_created: 'Consulta agendada', goal_created: 'Meta criada' }[a.action] || 'Atividade registrada'}</div><div class="row-secondary">${dateFmt(a.at)}</div></div></div>`).join('') : `<div class="empty-inline"><strong>Nenhuma atividade ainda</strong>Suas movimentações aparecerão aqui.</div>`}</section></div><div class="action-grid"><button class="quick-action" id="quick-patient"><span>＋</span><strong>Cadastrar paciente</strong><small>Inicie um acompanhamento</small></button><button class="quick-action" id="quick-appointment"><span>▦</span><strong>Agendar consulta</strong><small>Organize seus próximos horários</small></button><button class="quick-action" id="quick-assessment"><span>↗</span><strong>Registrar avaliação</strong><small>Atualize medidas corporais</small></button></div>`;
  $('#quick-patient').onclick = () => patientModal();
  $('#quick-appointment').onclick = () => appointmentModal();
  $('#quick-assessment').onclick = () => assessmentModal();
  $$('[data-go]').forEach((x) => (x.onclick = () => navigate(x.dataset.go)));
}
async function clinicDashboard() {
  const d = await api('/api/dashboard');
  const canManageMembers = state.activeRoles.some((role) => ['owner_admin', 'operations_admin'].includes(role));
  const canAssign = state.activeRoles.some((role) => ['owner_admin', 'operations_admin'].includes(role));
  const [membersResult, invitationsResult, cliniciansResult] = await Promise.all([
    canManageMembers ? api(`/api/workspaces/${encodeURIComponent(state.workspaceId)}/members`) : Promise.resolve({ members: [] }),
    canManageMembers ? api(`/api/workspaces/${encodeURIComponent(state.workspaceId)}/invitations`) : Promise.resolve({ invitations: [] }),
    canAssign ? api('/api/clinicians') : Promise.resolve({ clinicians: [] }),
  ]);
  const cards = [
    ['Pacientes cadastrados', d.patients, `${d.newThisMonth} novos neste mês`, '♧', 'mint'],
    ['Pacientes ativos', d.activePatients, 'Pacientes com cadastro ativo', '♡', 'honey'],
  ];
  if (canManageMembers) {
    cards.push(['Membros da equipe', membersResult.members.length, 'Pessoas com acesso ativo', '♙', 'peach']);
    cards.push(['Convites pendentes', invitationsResult.invitations.filter((item) => item.status === 'pending').length, 'Aguardando aceite', '✉', 'mint']);
  }
  if (canAssign) cards.push(['Nutricionistas', cliniciansResult.clinicians.length, 'Nutricionistas ativos', '◎', 'honey']);
  $('#content').innerHTML = `${heading('Visão geral', 'Acompanhe pacientes, profissionais e convites do consultório.')}
    <section class="stats">${cards.map((card) => `<article class="stat-card"><div class="stat-top">${card[0]}<span class="stat-icon ${card[4]}">${card[3]}</span></div><div class="stat-value">${card[1]}</div><div class="stat-hint">${esc(card[2])}</div></article>`).join('')}</section>
    <div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Próximas consultas</h2><p>Agenda do consultório</p></div><button class="text-action" data-go="agenda">Ver agenda →</button></div>${d.upcoming.length ? d.upcoming.map((item) => `<div class="appointment-row"><div class="time-block">${timeFmt(item.start)}</div><div><div class="row-primary">${esc(item.patientName)}</div><div class="row-secondary">${dateFmt(item.start)} · ${esc(item.type)}</div></div><span class="status-pill">Agendada</span></div>`).join('') : '<div class="empty-inline"><strong>Nenhuma consulta próxima</strong>Agendamentos futuros aparecerão aqui.</div>'}</section><section class="panel"><div class="panel-head"><div><h2>Atividade recente</h2><p>Atividade do consultório</p></div></div>${d.recent.length ? d.recent.map((item) => `<div class="activity-row"><div class="avatar">•</div><div><div class="row-primary">${esc(item.action.replaceAll('_', ' '))}</div><div class="row-secondary">${dateFmt(item.at)}</div></div></div>`).join('') : '<div class="empty-inline">Nenhuma atividade administrativa ainda.</div>'}</section></div>`;
  $$('[data-go]').forEach((button) => (button.onclick = () => navigate(button.dataset.go)));
}
function newPatientsChart(months) {
  const max = Math.max(...months.map((m) => m.total), 1);
  return `<div class="new-patient-chart" role="img" aria-label="Novos pacientes por mês nos últimos seis meses">${months.map((m) => `<div class="month-column"><div class="bar-area"><span class="bar-value">${m.total || ''}</span><div class="month-bar" style="height:${m.total ? Math.max(8, (m.total / max) * 100) : 0}%"></div></div><span class="month-label">${esc(m.label)}</span></div>`).join('')}</div>`;
}
async function assessmentsPage() {
  const { assessments } = await api('/api/assessments');
  $('#content').innerHTML =
    `${heading('Avaliações', 'Acompanhe as medidas registradas nos perfis dos seus pacientes.', `<button class="button primary" id="new-assessment">＋ Registrar avaliação</button>`)}<section class="panel assessment-list-panel">${assessments.length ? `<div class="table-scroll"><table class="table"><thead><tr><th>Paciente</th><th>Data</th><th>Peso</th><th>IMC</th><th>Cintura</th><th>% gordura</th></tr></thead><tbody>${assessments.map((a) => `<tr><td><button class="table-link" data-patient="${a.patientId}">${esc(a.patientName)}</button></td><td>${dateFmt(a.date)}</td><td>${a.weight ?? '—'} ${a.weight === null ? '' : 'kg'}</td><td>${a.bmi ?? '—'}</td><td>${a.waist ?? '—'} ${a.waist === null ? '' : 'cm'}</td><td>${a.fat ?? '—'} ${a.fat === null ? '' : '%'}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty"><div class="empty-mark">⌁</div><h3>Suas avaliações aparecerão aqui</h3><p>Registre medidas antropométricas no perfil do paciente para acompanhar a evolução ao longo do tempo.</p><button class="button primary" id="empty-assessment">＋ Registrar avaliação</button></div>`}</section>`;
  $('#new-assessment').onclick = () => assessmentModal();
  $('#empty-assessment')?.addEventListener('click', () => assessmentModal());
  $$('[data-patient]').forEach((x) => (x.onclick = () => patientProfile(x.dataset.patient)));
}
function foodItemMarkup(item = {}) {
  return `<div class="food-item-editor"><div class="field"><label>Alimento ou preparação</label><input class="food-name" required maxlength="180" value="${esc(item.food || '')}" placeholder="Ex.: arroz integral"></div><div class="food-quantity-wrap"><div class="field"><label>Quantidade</label><input class="food-quantity" type="number" min="0.01" step="any" value="${item.quantity ?? ''}" placeholder="100"></div><div class="field"><label>Unidade</label><input class="food-unit" maxlength="40" value="${esc(item.unit || '')}" placeholder="g, ml, unidade"></div></div><div class="field food-detail"><label>Substituições (opcional)</label><input class="food-substitutions" maxlength="500" value="${esc(item.substitutions || '')}" placeholder="Opções combinadas com o profissional"></div><button type="button" class="icon-button remove-food" aria-label="Remover alimento">×</button></div>`;
}
function mealEditorMarkup(meal = {}) {
  return `<article class="meal-editor"><div class="meal-editor-head"><span class="meal-index">Refeição</span><button type="button" class="text-action remove-meal">Remover</button></div><div class="form-grid"><div class="field"><label>Nome da refeição</label><input class="meal-name" required maxlength="100" value="${esc(meal.name || '')}" placeholder="Ex.: Café da manhã"></div><div class="field"><label>Horário sugerido</label><input class="meal-time" type="time" value="${esc(meal.time || '')}"></div><div class="field wide"><label>Orientações desta refeição</label><input class="meal-instructions" maxlength="1000" value="${esc(meal.instructions || '')}" placeholder="Opcional"></div></div><div class="food-items">${(meal.items || []).map(foodItemMarkup).join('') || '<p class="meal-empty">Adicione alimentos e quantidades a esta refeição.</p>'}</div><button type="button" class="button subtle add-food">＋ Adicionar alimento</button></article>`;
}
function bindMealEditor() {
  const host = $('#plan-meals'),
    form = $('#plan-form');
  form.onclick = (e) => {
    if (e.target.closest('.add-plan-meal')) {
      host.insertAdjacentHTML('beforeend', mealEditorMarkup({}));
      const added = host.lastElementChild;
      added.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      added.querySelector('.meal-name').focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('.add-food')) {
      const list = e.target.closest('.meal-editor').querySelector('.food-items');
      list.querySelector('.meal-empty')?.remove();
      list.insertAdjacentHTML('beforeend', foodItemMarkup({}));
      const added = list.lastElementChild;
      added.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      added.querySelector('.food-name').focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('.remove-food')) {
      const list = e.target.closest('.food-items');
      e.target.closest('.food-item-editor').remove();
      if (!list.querySelector('.food-item-editor'))
        list.innerHTML =
          '<p class="meal-empty">Adicione alimentos e quantidades a esta refeição.</p>';
      return;
    }
    if (e.target.closest('.remove-meal')) {
      e.target.closest('.meal-editor').remove();
    }
  };
}
function planPayload(form) {
  return {
    name: form.name.trim(),
    patientId: form.patientId,
    objective: form.objective,
    generalInstructions: form.generalInstructions,
    startDate: form.startDate,
    reviewDate: form.reviewDate,
    meals: $$('#plan-meals .meal-editor').map((m) => ({
      name: m.querySelector('.meal-name').value,
      time: m.querySelector('.meal-time').value,
      instructions: m.querySelector('.meal-instructions').value,
      items: [...m.querySelectorAll('.food-item-editor')].map((i) => ({
        food: i.querySelector('.food-name').value,
        quantity: i.querySelector('.food-quantity').value,
        unit: i.querySelector('.food-unit').value,
        substitutions: i.querySelector('.food-substitutions').value,
      })),
    })),
  };
}
async function mealPlansPage() {
  const { mealPlans } = await api('/api/meal-plans');
  $('#content').innerHTML =
    `${heading('Planos alimentares', 'Monte refeições individuais e preserve cada versão do plano.', `<button class="button primary" id="new-plan">＋ Novo plano</button>`)}<div class="plan-privacy-note"><strong>Versões preservadas</strong><span>Publicar cria uma versão registrada e imutável. O paciente verá somente as versões publicadas no portal separado.</span></div>${mealPlans.length ? `<div class="plan-list">${mealPlans.map((p) => `<article class="panel plan-card"><div class="plan-card-head"><div class="patient-initial">${esc((p.patientName || '?')[0].toUpperCase())}</div><div class="plan-card-title"><h2>${esc(p.name)}</h2><p>${esc(p.patientName)} · ${p.latestVersion?.mealCount || 0} refeições na versão atual</p></div><span class="plan-status ${p.status === 'published' ? 'published' : ''}">${p.status === 'published' ? 'Publicado' : 'Rascunho'}</span></div><div class="plan-card-meta"><span>Versão ${p.latestVersion?.number || 1}</span><span>${p.versionCount} ${p.versionCount === 1 ? 'versão' : 'versões'}</span>${p.publishedVersion ? `<span>Publicada: v${p.publishedVersion}</span>` : ''}</div><div class="plan-card-actions"><button class="button" data-edit-plan="${p.id}">${p.status === 'published' ? '＋ Nova versão' : 'Editar rascunho'}</button>${p.status === 'draft' ? `<button class="button primary" data-publish-plan="${p.id}">Publicar versão</button>` : ''}</div><details class="version-history" data-plan-id="${p.id}"><summary>Histórico de versões</summary><div class="version-history-content"><small>Abra para carregar o histórico.</small></div></details></article>`).join('')}</div>` : `<section class="empty"><div class="empty-mark">▤</div><h3>Nenhum plano alimentar ainda</h3><p>Crie um rascunho vinculado a um paciente. Alimentos, quantidades e unidades serão registrados sem estimar nutrientes.</p><button class="button primary" id="empty-plan">＋ Criar primeiro plano</button></section>`}`;
  $('#new-plan').onclick = () => mealPlanEditor();
  $('#empty-plan')?.addEventListener('click', () => mealPlanEditor());
  $$('[data-edit-plan]').forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          const { mealPlan } = await api(`/api/meal-plans/${b.dataset.editPlan}`);
          mealPlanEditor(mealPlan);
        } catch (e) {
          toast(e.message, true);
        }
      }),
  );
  $$('[data-publish-plan]').forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api(`/api/meal-plans/${b.dataset.publishPlan}/publish`, {
            method: 'POST',
            body: '{}',
          });
          toast('Versão publicada e preservada');
          await mealPlansPage();
        } catch (e) {
          toast(e.message, true);
        }
      }),
  );
}
function mealPlanEditor(plan = null) {
  if (!state.patients.length) {
    toast('Cadastre um paciente antes de criar um plano.', true);
    return;
  }
  const latest = plan?.versions.at(-1);
  const selected = latest || null;
  const patientSelect = plan
    ? ''
    : field('patientId', 'Paciente', 'select', {
        required: true,
        wide: true,
        options: state.patients
          .filter((p) => p.status !== 'Arquivado')
          .map((p) => ({ value: p.id, label: p.name })),
      });
  const d = $('#modal'),
    root = $('#modal-content');
  root.innerHTML = `<h2>${plan ? (latest?.status === 'published' ? 'Criar nova versão' : 'Editar rascunho') : 'Criar plano alimentar'}</h2><p class="modal-intro">${plan ? 'A versão já publicada será preservada; as alterações ficam em um rascunho novo.' : 'O plano começa como rascunho e pode ser publicado após revisar os itens.'}</p><form id="plan-form"><div class="form-grid">${patientSelect}${field('name', 'Nome do plano', 'text', { required: true, wide: true, placeholder: 'Ex.: Plano de acompanhamento' })}${field('objective', 'Objetivo do plano', 'textarea', { wide: true, placeholder: 'Contexto e objetivo definidos pelo profissional' })}${field('startDate', 'Início da vigência', 'date')}${field('reviewDate', 'Data de revisão', 'date')}${field('generalInstructions', 'Orientações gerais', 'textarea', { wide: true, placeholder: 'Orientações fornecidas pelo profissional' })}</div><div class="meal-section-head"><div><h3>Refeições</h3><p>Valores nutricionais não são calculados automaticamente.</p></div><button type="button" class="button subtle add-plan-meal">＋ Adicionar refeição</button></div><div id="plan-meals">${(selected?.meals?.length ? selected.meals : [{}]).map(mealEditorMarkup).join('')}</div><div class="modal-actions"><button type="button" class="button" id="cancel-plan">Cancelar</button><button class="button primary">Salvar rascunho</button></div></form>`;
  $('#cancel-plan').onclick = () => d.close();
  bindMealEditor();
  $('#plan-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const payload = planPayload(form);
    if (!payload.meals.length) {
      toast('Adicione pelo menos uma refeição.', true);
      return;
    }
    try {
      if (plan)
        await api(`/api/meal-plans/${plan.id}/draft`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      else await api('/api/meal-plans', { method: 'POST', body: JSON.stringify(payload) });
      d.close();
      toast(
        plan && latest?.status === 'published'
          ? 'Nova versão salva como rascunho'
          : 'Rascunho salvo',
      );
      await mealPlansPage();
    } catch (err) {
      toast(err.message, true);
    }
  };
  d.showModal();
}
async function patientModal(p = null) {
  const currentWorkspace = state.workspaces.find((item) => item.id === state.workspaceId);
  const roles = currentWorkspace?.roles || [];
  const canAssign = roles.some((role) => ['owner_admin', 'operations_admin'].includes(role));
  const isClinician = roles.includes('clinician');
  const detail = p ? await api(`/api/patients/${p.id}`) : null;
  const clinicians = canAssign
    ? (await api('/api/clinicians')).clinicians
    : isClinician && !p
      ? [{ id: state.user.id, name: state.user.name, email: state.user.email }]
      : [];
  const currentAssignments = detail?.assignments || [];
  const primary = currentAssignments.find((item) => item.kind === 'primary')?.professionalId || '';
  const support = currentAssignments
    .filter((item) => item.kind === 'support')
    .map((item) => item.professionalId);
  const assignmentFields = canAssign
    ? `${field('primaryProfessionalId', 'Responsável clínico principal', 'select', {
        options: [
          { value: '', label: 'Sem atribuição clínica' },
          ...clinicians.map((professional) => ({
            value: professional.id,
            label: `${professional.name} · ${professional.email}`,
          })),
        ],
      })}<div class="field wide"><label for="supportProfessionalIds">Profissionais de apoio</label><select id="supportProfessionalIds" name="supportProfessionalIds" multiple size="${Math.max(2, Math.min(4, clinicians.length))}">${clinicians.map((professional) => `<option value="${esc(professional.id)}">${esc(professional.name)} · ${esc(professional.email)}</option>`).join('')}</select><small>Use Ctrl para selecionar mais de um profissional.</small></div>`
    : isClinician && !p
      ? field('primaryProfessionalId', 'Responsável clínico principal', 'select', {
          required: true,
          options: clinicians.map((professional) => ({
            value: professional.id,
            label: `${professional.name} · ${professional.email}`,
          })),
        })
      : '';
  const clinicalFields = detail?.clinicalAccess || (!p && isClinician)
    ? `${field('objective', 'Objetivo principal', 'textarea', { wide: true, placeholder: 'Opcional' })}${field('clinicalNotes', 'Observações profissionais', 'textarea', { wide: true, placeholder: 'Use apenas informações necessárias ao atendimento.' })}`
    : '';
  const demographicFields = !p || canAssign
    ? `${field('name', 'Nome completo', 'text', { required: true, wide: true, placeholder: 'Nome do paciente' })}${field('email', 'E-mail', 'email')}${field('phone', 'Telefone', 'tel')}${field('birthDate', 'Data de nascimento', 'date')}${field('status', 'Status', 'select', { options: ['Ativo', 'Em pausa', 'Arquivado'] })}`
    : '<p class="muted wide">Dados cadastrais são gerenciados pela equipe administrativa.</p>';
  openModal(
    p ? 'Editar paciente' : 'Cadastrar paciente',
    p ? 'Atualize os dados cadastrais.' : 'Informações mínimas para iniciar o acompanhamento.',
    `${demographicFields}${assignmentFields}${clinicalFields}`,
    'Salvar paciente',
    async (d) => {
      const payload = { ...d };
    const primaryProfessionalId = payload.primaryProfessionalId || '';
      const supportProfessionalIds = payload.supportProfessionalIds || [];
      delete payload.primaryProfessionalId;
      delete payload.supportProfessionalIds;
      let patientId = p?.id;
      if (p) await api(`/api/patients/${p.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else {
        const result = await api('/api/patients', {
          method: 'POST',
          body: JSON.stringify({ ...payload, primaryProfessionalId, supportProfessionalIds }),
        });
        patientId = result.patient.id;
      }
      if (canAssign && p)
        await api(`/api/patients/${patientId}/assignments`, {
          method: 'PUT',
          body: JSON.stringify({ primaryProfessionalId, supportProfessionalIds }),
        });
      await loadPatients();
      if (state.page === 'patients') patientsPage();
      else dashboard();
      toast(p ? 'Cadastro atualizado' : 'Paciente cadastrado');
    },
  );
  if (p)
    for (const [k, v] of Object.entries(p)) {
      const el = $(`#modal-form [name="${k}"]`);
      if (el) el.value = v;
    }
  if (primary) $('#modal-form [name="primaryProfessionalId"]').value = primary;
  if (!p && isClinician && !canAssign)
    $('#modal-form [name="primaryProfessionalId"]').value = state.user.id;
  for (const option of $$('#modal-form [name="supportProfessionalIds"] option'))
    option.selected = support.includes(option.value);
}
function patientCard(p) {
  return `<article class="patient-card"><div class="patient-initial">${esc(p.name.trim().charAt(0).toUpperCase())}</div><div class="patient-details"><strong>${esc(p.name)}</strong><small>${esc(p.email || 'Sem e-mail')} · ${p.birthDate ? `Nascimento ${dateFmt(p.birthDate)}` : 'Data de nascimento não informada'}</small></div><span class="status-pill">${esc(p.status)}</span><div class="patient-actions"><button class="button" data-edit="${p.id}">Editar</button><button class="button subtle" data-open="${p.id}">Abrir perfil</button></div></article>`;
}
function patientsPage() {
  const list = state.patients.filter(
    (p) =>
      (state.status === 'Todos' || p.status === state.status) &&
      p.name.toLowerCase().includes(state.query.toLowerCase()),
  );
  $('#content').innerHTML =
    `${heading('Pacientes', 'Organize os cadastros e acompanhe a evolução individual.', `<button class="button primary" id="new-patient">＋ Novo paciente</button>`)}<div class="toolbar"><input class="search" id="patient-search" placeholder="⌕  Buscar por nome" value="${esc(state.query)}"><select id="patient-filter"><option>Todos</option>${['Ativo', 'Em pausa', 'Arquivado'].map((s) => `<option ${state.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select><span class="muted" style="margin-left:auto;font-size:11px">${list.length} paciente${list.length === 1 ? '' : 's'}</span></div><div class="patient-list">${list.length ? list.map(patientCard).join('') : `<section class="empty"><div style="font-size:28px;color:#81a47f">♧</div><h3>${state.patients.length ? 'Nenhum resultado' : 'Seu acompanhamento começa aqui'}</h3><p>${state.patients.length ? 'Ajuste a busca ou o filtro para encontrar um paciente.' : 'Cadastre seu primeiro paciente para organizar consultas, avaliações e metas em um só lugar.'}</p>${state.patients.length ? '' : '<button class="button primary" id="empty-create">＋ Cadastrar paciente</button>'}</section>`}</div>`;
  $('#new-patient').onclick = () => patientModal();
  $('#empty-create')?.addEventListener('click', () => patientModal());
  $('#patient-search').oninput = (e) => {
    state.query = e.target.value;
    patientsPage();
    const i = $('#patient-search');
    i.focus();
    i.setSelectionRange(i.value.length, i.value.length);
  };
  $('#patient-filter').onchange = (e) => {
    state.status = e.target.value;
    patientsPage();
  };
  $$('[data-edit]').forEach(
    (x) => (x.onclick = () => patientModal(state.patients.find((p) => p.id === x.dataset.edit))),
  );
  $$('[data-open]').forEach((x) => (x.onclick = () => patientProfile(x.dataset.open)));
}
async function patientProfile(id) {
  const d = await api(`/api/patients/${id}`);
  state.patientData = d;
  state.patient = d.patient;
  const p = d.patient,
    ass = d.assessments;
  $('#crumb').innerHTML =
    `<a href="#patients" id="back-patients" style="color:#607268;text-decoration:none">Pacientes</a> <span>/</span> ${esc(p.name)}`;
  $('#back-patients').onclick = (e) => {
    e.preventDefault();
    navigate('patients');
  };
  $('#content').innerHTML =
    `<div class="page-heading"><div style="display:flex;align-items:center;gap:13px"><div class="patient-initial" style="width:48px;height:48px;font-size:18px">${esc(p.name[0].toUpperCase())}</div><div><h1>${esc(p.name)}</h1><p>${esc(p.email || 'E-mail não informado')} · <span class="status-pill">${esc(p.status)}</span></p></div></div><div style="display:flex;gap:8px"><button class="button" id="edit-patient">Editar cadastro</button><button class="button primary" id="add-assessment">＋ Avaliação</button></div></div><div class="detail-tabs"><button class="tab active" data-tab="overview">Visão geral</button><button class="tab" data-tab="assessments">Avaliações</button><button class="tab" data-tab="appointments">Consultas</button><button class="tab" data-tab="goals">Metas</button><button class="tab" data-tab="clinical">Histórico clínico</button></div><div id="patient-tab-content"></div>`;
  $('#edit-patient').onclick = () => patientModal(p);
  $('#add-assessment').hidden = !d.clinicalAccess;
  if (d.clinicalAccess) $('#add-assessment').onclick = () => assessmentModal(p.id);
  const portalButton = document.createElement('button');
  const patientHasEmail = /^\S+@\S+\.\S+$/.test(p.email || '');
  const portalExists = d.portal?.exists ?? !!d.portal?.enabled;
  const portalStatus = d.portal?.status || (d.portal?.enabled ? 'active' : null);
  portalButton.className = portalStatus === 'active' ? 'button portal-enabled' : 'button subtle';
  portalButton.textContent = portalExists
    ? portalStatus === 'active'
      ? 'Portal ativo'
      : portalStatus === 'suspended'
        ? 'Portal suspenso'
        : 'Acesso revogado'
    : patientHasEmail
      ? '＋ Convidar para o portal'
      : 'Informe e-mail para convidar';
  portalButton.disabled = portalExists || !patientHasEmail;
  if (!portalExists && patientHasEmail)
    portalButton.onclick = () => createPatientInvitation(p.id, p.name);
  if (!patientHasEmail && !portalExists)
    portalButton.title = 'Cadastre um e-mail válido no perfil do paciente antes do convite.';
  const profileActions = $('.page-heading>div:last-child');
  profileActions.classList.add('patient-profile-actions');
  portalButton.hidden = !d.clinicalAccess;
  profileActions.prepend(portalButton);
  if (portalExists && portalStatus !== 'revoked') {
    const accessButton = document.createElement('button');
    accessButton.className = portalStatus === 'suspended' ? 'button primary' : 'button subtle';
    accessButton.textContent = portalStatus === 'suspended' ? 'Reativar portal' : 'Suspender portal';
    accessButton.hidden = !d.clinicalAccess;
    accessButton.onclick = () => updatePatientPortalAccess(
      p.id,
      portalStatus === 'suspended' ? 'active' : 'suspended',
      p.name,
    );
    profileActions.prepend(accessButton);

    const revokeButton = document.createElement('button');
    revokeButton.className = 'button subtle';
    revokeButton.textContent = 'Revogar acesso';
    revokeButton.hidden = !d.clinicalAccess;
    revokeButton.onclick = () => updatePatientPortalAccess(p.id, 'revoked', p.name);
    profileActions.prepend(revokeButton);
  }
  if (portalStatus === 'active') {
    const resetButton = document.createElement('button');
    resetButton.className = 'button subtle';
    resetButton.textContent = 'Redefinir senha do portal';
    resetButton.onclick = () => createPatientPasswordReset(p.id, p.name);
    resetButton.hidden = !d.clinicalAccess;
    profileActions.prepend(resetButton);
  }
  if (!d.clinicalAccess)
    $$('[data-tab="assessments"], [data-tab="goals"], [data-tab="clinical"]').forEach((tab) => { tab.hidden = true; });
  $$('[data-tab]').forEach(
    (x) =>
      (x.onclick = () => {
        $$('[data-tab]').forEach((y) => y.classList.toggle('active', x === y));
        renderPatientTab(x.dataset.tab);
      }),
  );
  renderPatientTab('overview');
}
async function updatePatientPortalAccess(patientId, status, patientName) {
  const messages = {
    active: `Reativar o acesso ao portal de ${patientName}? A paciente precisará entrar novamente.`,
    suspended: `Suspender o acesso ao portal de ${patientName}? As sessões atuais serão encerradas.`,
    revoked: `Revogar permanentemente o acesso ao portal de ${patientName}? Esta ação não poderá ser desfeita.`,
  };
  if (!window.confirm(messages[status])) return;
  try {
    await api(`/api/patients/${encodeURIComponent(patientId)}/portal-access`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    toast(status === 'active' ? 'Acesso ao portal reativado.' : status === 'suspended'
      ? 'Acesso ao portal suspenso.'
      : 'Acesso ao portal revogado.');
    await patientProfile(patientId);
  } catch (error) {
    toast(error.message, true);
  }
}
function renderPatientTab(tab) {
  const d = state.patientData,
    p = d.patient,
    ass = d.assessments,
    latest = ass[0];
  const box = $('#patient-tab-content');
  if (tab === 'overview') {
    if (!d.clinicalAccess) {
      box.innerHTML = `<div class="metric-grid"><div class="metric"><small>Consultas neste consultório</small><strong>${d.appointments.length}</strong></div></div><section class="panel"><div class="panel-head"><div><h2>Agenda</h2><p>Informações clínicas são exibidas somente ao profissional atribuído.</p></div></div>${d.appointments.length ? d.appointments.map((appointment) => `<div class="appointment-row"><div class="time-block">${timeFmt(appointment.start)}</div><div class="row-primary">${dateFmt(appointment.start)} · ${esc(appointment.type)}</div><span class="status-pill">${esc(appointment.status)}</span></div>`).join('') : '<div class="empty-inline">Nenhuma consulta cadastrada.</div>'}<div style="margin-top:17px"><button class="button subtle" id="profile-appointment">＋ Agendar consulta</button></div></section>`;
      $('#profile-appointment').onclick = () => appointmentModal(p.id);
      return;
    }
    box.innerHTML = `<div class="metric-grid"><div class="metric"><small>Avaliações registradas</small><strong>${ass.length}</strong></div><div class="metric"><small>Peso mais recente</small><strong>${latest?.weight != null ? latest.weight + ' kg' : '—'}</strong></div><div class="metric"><small>IMC mais recente</small><strong>${latest?.bmi ?? '—'}</strong></div><div class="metric"><small>Consultas</small><strong>${d.appointments.length}</strong></div></div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Evolução do peso</h2><p>Valores registrados em avaliações</p></div><button class="text-action" data-tab="assessments">Ver histórico →</button></div>${ass.filter((a) => a.weight != null).length ? weightChart(ass) : '<div class="empty-inline">Ainda não há medidas de peso registradas.</div>'}</section><section class="panel"><div class="panel-head"><div><h2>Resumo do acompanhamento</h2><p>Informações do cadastro</p></div></div><p class="row-secondary">Objetivo principal</p><div class="row-primary" style="margin:5px 0 16px">${esc(p.objective || 'Não informado')}</div><p class="row-secondary">Próxima consulta</p><div class="row-primary" style="margin-top:5px">${d.appointments.filter((a) => a.status === 'agendada').length ? dateFmt(d.appointments.find((a) => a.status === 'agendada').start) : 'Nenhuma agendada'}</div><div style="margin-top:17px"><button class="button subtle" id="profile-appointment">＋ Agendar consulta</button></div></section></div>`;
    $('#profile-appointment').onclick = () => appointmentModal(p.id);
    $$('[data-tab]').forEach(
      (x) =>
        (x.onclick = () => {
          $$('[data-tab]').forEach((y) => y.classList.toggle('active', x === y));
          renderPatientTab(x.dataset.tab);
        }),
    );
  } else if (tab === 'assessments') {
    box.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Avaliações antropométricas</h2><p>As medidas ausentes permanecem sem valor.</p></div><button class="button primary" id="add-assessment-tab">＋ Registrar</button></div>${ass.length ? `<div style="overflow:auto"><table class="table"><thead><tr><th>Data</th><th>Peso</th><th>Altura</th><th>IMC</th><th>Cintura</th><th>% gordura</th><th>Método</th></tr></thead><tbody>${ass.map((a) => `<tr><td>${dateFmt(a.date)}</td><td>${a.weight ?? '—'} ${a.weight ? 'kg' : ''}</td><td>${a.height ?? '—'} ${a.height ? 'cm' : ''}</td><td>${a.bmi ?? '—'}</td><td>${a.waist ?? '—'} ${a.waist ? 'cm' : ''}</td><td>${a.fat ?? '—'} ${a.fat !== null ? '%' : ''}</td><td>${esc(a.method || '—')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-inline">Nenhuma avaliação registrada.</div>`}</section>`;
    $('#add-assessment-tab').onclick = () => assessmentModal(p.id);
  } else if (tab === 'appointments') {
    box.innerHTML = `<section class="panel"><div class="panel-head"><h2>Histórico de consultas</h2><button class="button primary" id="add-appt">＋ Agendar</button></div>${d.appointments.length ? d.appointments.map((a) => `<div class="appointment-row"><div class="time-block">${timeFmt(a.start)}</div><div><div class="row-primary">${dateFmt(a.start)} · ${esc(a.type)}</div><div class="row-secondary">${esc(a.notes || 'Sem observações')}</div></div><select class="appt-status" data-id="${a.id}"><option value="agendada" ${a.status === 'agendada' ? 'selected' : ''}>Agendada</option><option value="realizada" ${a.status === 'realizada' ? 'selected' : ''}>Realizada</option><option value="falta" ${a.status === 'falta' ? 'selected' : ''}>Falta</option><option value="cancelada" ${a.status === 'cancelada' ? 'selected' : ''}>Cancelada</option></select></div>`).join('') : '<div class="empty-inline">Nenhuma consulta no histórico.</div>'}</section>`;
    $('#add-appt').onclick = () => appointmentModal(p.id);
    $$('.appt-status').forEach(
      (x) =>
        (x.onchange = async () => {
          try {
            await api(`/api/appointments/${x.dataset.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: x.value }),
            });
            toast('Status da consulta atualizado');
          } catch (e) {
            toast(e.message, true);
          }
        }),
    );
  } else if (tab === 'goals') {
    box.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Metas individuais</h2><p>Metas definidas para este acompanhamento</p></div><button class="button primary" id="add-goal">＋ Nova meta</button></div>${d.goals.length ? d.goals.map((g) => goalRow(g)).join('') : '<div class="empty-inline">Nenhuma meta registrada.</div>'}</section>`;
    $('#add-goal').onclick = () => goalModal(p.id);
    $$('.goal-status').forEach(
      (x) =>
        (x.onchange = async () => {
          await api(`/api/goals/${x.dataset.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: x.value }),
          });
          toast('Meta atualizada');
          patientProfile(p.id);
        }),
    );
  } else {
    box.innerHTML = `<section class="panel"><h2 style="font:700 14px Manrope">Histórico clínico</h2><p class="muted" style="font-size:12px">${esc(p.clinicalNotes || 'Não há observações clínicas registradas.')}</p><p class="row-secondary" style="margin-top:18px">Objetivo principal: ${esc(p.objective || 'Não informado')}</p></section>`;
  }
}
function weightChart(ass) {
  const points = ass
      .filter((a) => a.weight != null)
      .slice(0, 8)
      .reverse(),
    vals = points.map((a) => a.weight),
    min = Math.min(...vals) - 1,
    max = Math.max(...vals) + 1,
    range = max - min || 1;
  const coords = points.map((a, i) => ({
    x: 18 + i * (94 / Math.max(points.length - 1, 1)),
    y: 145 - ((a.weight - min) / range) * 112,
    a,
  }));
  const path = coords.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  return `<div class="chart-wrap"><svg viewBox="0 0 120 170" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="#527a5f" stroke-width="2" vector-effect="non-scaling-stroke"/>${coords.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="#527a5f"><title>${dateFmt(p.a.date)}: ${p.a.weight} kg</title></circle>`).join('')}</svg></div><div style="display:flex;justify-content:space-between;color:#98a198;font-size:10px">${coords.length ? `<span>${dateFmt(coords[0].a.date)}</span><span>${dateFmt(coords.at(-1).a.date)}</span>` : ''}</div>`;
}
function goalRow(g) {
  return `<div class="appointment-row"><div class="avatar">◎</div><div style="flex:1"><div class="row-primary">${esc(g.description)}</div><div class="row-secondary">${esc(g.category)}${g.dueDate ? ' · prazo ' + dateFmt(g.dueDate) : ''}</div></div><select class="goal-status" data-id="${g.id}"><option value="ativa" ${g.status === 'ativa' ? 'selected' : ''}>Ativa</option><option value="concluida" ${g.status === 'concluida' ? 'selected' : ''}>Concluída</option><option value="pausada" ${g.status === 'pausada' ? 'selected' : ''}>Pausada</option></select></div>`;
}
function assessmentModal(patientId = null) {
  if (!state.patients.length) {
    toast('Cadastre um paciente antes de registrar uma avaliação.', true);
    return;
  }
  const patientField = patientId
    ? ''
    : field('patientId', 'Paciente', 'select', {
        required: true,
        wide: true,
        options: state.patients
          .filter((p) => p.status !== 'Arquivado')
          .map((p) => ({ value: p.id, label: p.name })),
      });
  openModal(
    'Registrar avaliação',
    'Registre somente as medidas coletadas nesta avaliação.',
    `${patientField}${field('date', 'Data da avaliação', 'date', { required: true })}${field('weight', 'Peso (kg)', 'number', { step: '.01', min: '.01' })}${field('height', 'Altura (cm)', 'number', { step: '.1', min: '.1' })}${field('waist', 'Circunferência da cintura (cm)', 'number', { step: '.1', min: '0' })}${field('hip', 'Circunferência do quadril (cm)', 'number', { step: '.1', min: '0' })}${field('fat', 'Gordura corporal (%)', 'number', { step: '.1', min: '0' })}${field('method', 'Método de avaliação', 'text', { wide: true, placeholder: 'Opcional' })}${field('notes', 'Observações profissionais', 'textarea', { wide: true })}`,
    'Salvar avaliação',
    async (data) => {
      data.patientId = patientId || data.patientId;
      await api('/api/assessments', { method: 'POST', body: JSON.stringify(data) });
      toast('Avaliação registrada');
      if (state.patient) await patientProfile(data.patientId);
      else if (state.page === 'assessments') await assessmentsPage();
      else await dashboard();
    },
  );
  $('#modal-form [name=date]').value = new Date().toISOString().slice(0, 10);
}
function appointmentModal(patientId = null) {
  if (!state.patients.length) {
    toast('Cadastre um paciente antes de agendar.', true);
    return;
  }
  openModal(
    'Agendar consulta',
    'Horários são apresentados no fuso local do seu dispositivo.',
    `${field('patientId', 'Paciente', 'select', { options: state.patients.filter((p) => p.status !== 'Arquivado').map((p) => ({ value: p.id, label: p.name })) })}${field('start', 'Data e horário', 'datetime-local', { required: true })}${field('duration', 'Duração (minutos)', 'number', { min: '15', step: '5', placeholder: '50' })}${field('type', 'Tipo de atendimento', 'select', { options: ['Presencial', 'On-line', 'Outro'] })}${field('notes', 'Observações', 'textarea', { wide: true })}`,
    'Agendar',
    async (data) => {
      data.start = new Date(data.start).toISOString();
      await api('/api/appointments', { method: 'POST', body: JSON.stringify(data) });
      toast('Consulta agendada');
      if (state.patient) await patientProfile(state.patient.id);
      else await dashboard();
    },
  );
  if (patientId) $('#modal-form [name=patientId]').value = patientId;
  const dt = new Date(Date.now() + 3600000);
  dt.setMinutes(Math.ceil(dt.getMinutes() / 15) * 15, 0, 0);
  $('#modal-form [name=start]').value = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function goalModal(patientId = null) {
  if (!patientId && !state.patients.length) {
    toast('Cadastre um paciente antes de definir metas.', true);
    return;
  }
  openModal(
    'Criar meta',
    'Defina um objetivo individual para o acompanhamento.',
    `${field('patientId', 'Paciente', 'select', { options: state.patients.map((p) => ({ value: p.id, label: p.name })) })}${field('category', 'Categoria', 'select', { options: ['Hábitos', 'Rotina', 'Hidratação', 'Alimentação', 'Acompanhamento', 'Outra'] })}${field('description', 'Descrição da meta', 'textarea', { required: true, wide: true, placeholder: 'Ex.: organizar horários de refeições conforme rotina' })}${field('dueDate', 'Prazo (opcional)', 'date')}`,
    'Criar meta',
    async (data) => {
      await api('/api/goals', { method: 'POST', body: JSON.stringify(data) });
      toast('Meta criada');
      if (state.patient) await patientProfile(state.patient.id);
      else goalsPage();
    },
  );
  if (patientId) $('#modal-form [name=patientId]').value = patientId;
}
async function agendaPage() {
  const d = await api('/api/appointments');
  state.appointments = d.appointments;
  const list = d.appointments;
  $('#content').innerHTML =
    `${heading('Agenda', 'Consulte os horários e atualize o andamento dos atendimentos.', `<button class="button primary" id="new-appt">＋ Agendar consulta</button>`)}<section class="panel">${list.length ? `<div style="overflow:auto"><table class="table"><thead><tr><th>Data e horário</th><th>Paciente</th><th>Tipo</th><th>Duração</th><th>Status</th></tr></thead><tbody>${list.map((a) => `<tr><td>${dateFmt(a.start)} · ${timeFmt(a.start)}</td><td>${esc(a.patientName)}</td><td>${esc(a.type)}</td><td>${a.duration} min</td><td><select class="appt-status" data-id="${a.id}"><option value="agendada" ${a.status === 'agendada' ? 'selected' : ''}>Agendada</option><option value="realizada" ${a.status === 'realizada' ? 'selected' : ''}>Realizada</option><option value="falta" ${a.status === 'falta' ? 'selected' : ''}>Falta</option><option value="cancelada" ${a.status === 'cancelada' ? 'selected' : ''}>Cancelada</option></select></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty"><div style="font-size:28px;color:#81a47f">▦</div><h3>Sua agenda está vazia</h3><p>Agende consultas para organizar os próximos atendimentos em um só lugar.</p><button class="button primary" id="empty-appt">＋ Agendar consulta</button></div>`}</section>`;
  $('#new-appt').onclick = () => appointmentModal();
  $('#empty-appt')?.addEventListener('click', () => appointmentModal());
  $$('.appt-status').forEach(
    (x) =>
      (x.onchange = async () => {
        try {
          await api(`/api/appointments/${x.dataset.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: x.value }),
          });
          toast('Status atualizado');
        } catch (e) {
          toast(e.message, true);
        }
      }),
  );
}
async function goalsPage() {
  await loadPatients();
  const all = [];
  for (const p of state.patients) {
    const d = await api(`/api/patients/${p.id}`);
    for (const g of d.goals) all.push({ ...g, patientName: p.name });
  }
  $('#content').innerHTML =
    `${heading('Metas', 'Acompanhe objetivos individuais definidos com seus pacientes.', `<button class="button primary" id="new-goal">＋ Nova meta</button>`)}<section class="panel">${all.length ? all.map((g) => `<div class="appointment-row"><div class="avatar">◎</div><div style="flex:1"><div class="row-primary">${esc(g.description)}</div><div class="row-secondary">${esc(g.patientName)} · ${esc(g.category)}${g.dueDate ? ' · prazo ' + dateFmt(g.dueDate) : ''}</div></div><span class="status-pill">${g.status === 'ativa' ? 'Ativa' : g.status === 'concluida' ? 'Concluída' : 'Pausada'}</span></div>`).join('') : `<div class="empty"><div style="font-size:28px;color:#81a47f">◎</div><h3>Nenhuma meta cadastrada</h3><p>Crie objetivos individuais de saúde e hábitos junto aos seus pacientes.</p><button class="button primary" id="empty-goal">＋ Criar meta</button></div>`}</section>`;
  $('#new-goal').onclick = () => goalModal();
  $('#empty-goal')?.addEventListener('click', () => goalModal());
}
function showOnboardingShell() {
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('.workspace-switcher').hidden = true;
  $('.nav-caption').hidden = true;
  $('nav[aria-label="Navegação principal"]').hidden = true;
  $('.privacy-card').hidden = true;
  $('.topbar').hidden = true;
}
async function workspaceSetup() {
  showOnboardingShell();
  $('#content').innerHTML = `<section class="panel onboarding-panel"><p class="eyebrow">CONFIGURE SEU ACESSO</p><h1>Como você vai usar o NutriTrack?</h1><p class="muted">Crie seu consultório ou entre em uma equipe por convite.</p><div class="onboarding-options"><article class="onboarding-option"><p class="eyebrow">CONSULTÓRIO PRÓPRIO</p><h2>Atendo por conta própria</h2><p>Escolha um nome para o consultório. Depois, você poderá convidar outras pessoas para a equipe.</p><form id="independent-workspace-form"><div class="field"><label for="independent-workspace-name">Nome do consultório</label><input id="independent-workspace-name" name="name" required maxlength="120" placeholder="Ex.: Consultório Ana Maria"></div><label class="onboarding-checkbox"><input type="checkbox" name="clinician"><span>Também vou atender pacientes e preciso de acesso clínico.</span></label><button class="button primary full">Criar meu consultório</button><p class="form-error" id="independent-error"></p></form></article><article class="onboarding-option"><p class="eyebrow">ENTRAR EM UMA EQUIPE</p><h2>Tenho um convite</h2><p>Cole o link enviado pela responsável pelo consultório. Seu acesso seguirá o convite.</p><form id="join-workspace-form"><div class="field"><label for="workspace-invite-input">Link do convite</label><input id="workspace-invite-input" name="invite" required placeholder="Cole aqui o link recebido"></div><button class="button full">Aceitar convite</button><p class="form-error" id="join-error"></p></form></article></div></section>`;
  $('#independent-workspace-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name'), type: 'individual', clinician: form.has('clinician') }),
      });
      localStorage.setItem('nutritrack-workspace-id', result.workspace.id);
      location.reload();
    } catch (error) { $('#independent-error').textContent = error.message; }
  };
  $('#join-workspace-form').onsubmit = async (event) => {
    event.preventDefault();
    const input = new FormData(event.currentTarget).get('invite').trim();
    let token = input;
    try { token = new URL(input, location.origin).searchParams.get('workspace_invite') || input; } catch {}
    try {
      const result = await api('/api/workspace-invitations/accept', { method: 'POST', body: JSON.stringify({ token }) });
      localStorage.setItem('nutritrack-workspace-id', result.workspace.id);
      location.reload();
    } catch (error) { $('#join-error').textContent = error.message; }
  };
}
async function legacyWorkspaceOnboarding() {
  const returnToWorkspace = state.workspaces.length > 0;
  const preview = await api('/api/workspaces/legacy-preview');
  showOnboardingShell();
  $('#content').innerHTML = `<section class="panel" style="max-width:760px;margin:48px auto;padding:28px"><p class="eyebrow">CONFIGURAÇÃO DO CONSULTÓRIO</p><h1>Organize seu espaço de trabalho</h1><p class="muted">Sua conta já existia antes da criação de workspaces. Esta etapa reúne seus registros antigos em um consultório e cria um backup antes da migração. Nenhum paciente será atribuído clinicamente sem sua seleção.</p><form id="legacy-workspace-form"><div class="form-grid"><div class="field wide"><label for="legacy-workspace-name">Nome do consultório</label><input id="legacy-workspace-name" name="name" required maxlength="120" value="Consultório de ${esc(state.user.name)}"></div><div class="field wide"><label class="auth-clinician-option"><input type="checkbox" name="clinician" id="legacy-clinician"> Também vou atender pacientes neste consultório</label></div></div>${preview.patients.length ? `<h2 style="font-size:16px;margin-top:26px">Atribuição clínica principal</h2><p class="muted">Marque somente os pacientes que você atende. Os demais registros ficarão acessíveis administrativamente.</p><div class="legacy-patient-list">${preview.patients.map((p) => `<label class="legacy-patient"><input type="checkbox" name="primaryPatientIds" value="${esc(p.id)}"><span>${esc(p.name)}</span></label>`).join('')}</div>` : '<p class="empty-inline" style="margin-top:22px">Não há pacientes antigos para migrar.</p>'}<div class="modal-actions" style="margin-top:24px">${returnToWorkspace ? '<button type="button" class="button" id="cancel-legacy-migration">Voltar sem migrar</button>' : ''}<button class="button primary">Criar consultório e organizar registros</button></div><p id="legacy-error" class="form-error"></p></form></section>`;
  $('#cancel-legacy-migration')?.addEventListener('click', () => location.reload());
  $('#legacy-workspace-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const clinician = form.has('clinician');
    const primaryPatientIds = form.getAll('primaryPatientIds');
    if (primaryPatientIds.length && !clinician) {
      $('#legacy-error').textContent = 'Marque que também atenderá clinicamente para atribuir pacientes.';
      return;
    }
    try {
      const result = await api('/api/workspaces/migrate-personal', {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name'), clinician, primaryPatientIds }),
      });
      localStorage.setItem('nutritrack-workspace-id', result.workspace.id);
      toast('Consultório criado; registros anteriores organizados com backup.');
      location.reload();
    } catch (error) {
      $('#legacy-error').textContent = error.message;
    }
  };
}
function createWorkspaceModal() {
  openModal(
    'Criar clínica',
    'Crie um consultório independente. Os pacientes e históricos ficam separados dos outros consultórios.',
    `${field('name', 'Nome da clínica', 'text', { required: true, wide: true, placeholder: 'Ex.: Clínica Nutrição Viva' })}`,
    'Criar clínica',
    async ({ name }) => {
      const { workspace } = await api('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name, type: 'clinic' }),
      });
      localStorage.setItem('nutritrack-workspace-id', workspace.id);
      location.reload();
    },
  );
}
const roleNames = {
  owner_admin: 'Proprietário administrativo',
  operations_admin: 'Administrador operacional',
  assistant: 'Assistente sem prontuário',
  clinician: 'Nutricionista',
};
async function teamPage() {
  if (!state.activeRoles.some((role) => ['owner_admin', 'operations_admin'].includes(role))) {
    $('#content').innerHTML = '<section class="empty"><h3>Acesso restrito</h3><p>Somente proprietárias e administradoras operacionais podem gerir a equipe.</p></section>';
    return;
  }
  const { members } = await api(`/api/workspaces/${encodeURIComponent(state.workspaceId)}/members`);
  const teamMembers = members.filter((member) => !member.roles.includes('clinician'));
  const isOwner = state.activeRoles.includes('owner_admin');
  $('#content').innerHTML = `${heading('Equipe', 'Gerencie quem cuida da administração deste consultório.', `<button class="button primary" data-go="invitations">＋ Ver convites</button>`)}
    <section class="panel team-members-panel"><div class="panel-head"><div><h2>Equipe administrativa</h2><p>${teamMembers.length} membro${teamMembers.length === 1 ? '' : 's'} na equipe deste consultório</p></div></div>${teamMembers.length ? teamMembers.map((member) => `<article class="team-member"><div class="avatar">${esc(member.name.trim()[0]?.toUpperCase() || '?')}</div><div class="team-member-copy"><strong>${esc(member.name)}</strong><small>${esc(member.email)} · ${member.roles.map((role) => esc(roleNames[role] || role)).join(', ')}</small></div>${member.userId === state.user.id ? '<span class="status-pill">Você</span>' : `<div class="team-member-actions"><button class="button" data-roles="${esc(member.id)}">Papéis</button><button class="button subtle" data-remove-member="${esc(member.id)}">Remover</button></div>`}</article>`).join('') : '<div class="empty-inline">Não há colaboradores administrativos além dos profissionais clínicos.</div>'}</section>`;
  $$('[data-go]').forEach((button) => (button.onclick = () => navigate(button.dataset.go)));
  $$('[data-roles]').forEach((button) => (button.onclick = () => {
    const member = members.find((item) => item.id === button.dataset.roles);
    const allowed = ['clinician', 'assistant', ...(isOwner ? ['operations_admin', 'owner_admin'] : [])];
    const checks = allowed.map((role) => `<label class="legacy-patient"><input type="checkbox" name="role" value="${role}" ${member.roles.includes(role) ? 'checked' : ''}><span>${esc(roleNames[role])}</span></label>`).join('');
    openModal('Papéis do membro', `Acessos atuais de ${esc(member.name)}. Acesso clínico a um paciente ainda exige atribuição explícita.`, checks, 'Salvar papéis', async ({ role }) => {
      const roles = Array.isArray(role) ? role : role ? [role] : [];
      if (!roles.length) throw Error('Selecione pelo menos um papel.');
      await api(`/api/workspaces/${encodeURIComponent(state.workspaceId)}/members/${encodeURIComponent(member.id)}`, { method: 'PATCH', body: JSON.stringify({ roles }) });
      await teamPage();
      toast('Papéis atualizados');
    });
    $('#modal-form').querySelectorAll('input[name="role"]').forEach((input) => { input.type = 'checkbox'; });
  }));
  $$('[data-remove-member]').forEach((button) => (button.onclick = async () => {
    const member = members.find((item) => item.id === button.dataset.removeMember);
    if (!confirm(`Remover ${member.name} da equipe deste consultório?`)) return;
    try {
      await api(`/api/workspaces/${encodeURIComponent(state.workspaceId)}/members/${encodeURIComponent(member.id)}`, { method: 'DELETE' });
      toast('Acesso removido do consultório');
      await teamPage();
    } catch (error) { toast(error.message, true); }
  }));
}
async function professionalsPage() {
  const { clinicians } = await api('/api/clinicians');
  $('#content').innerHTML = `${heading('Profissionais', 'Nutricionistas que atendem neste consultório.', `<button class="button primary" data-go="invitations">＋ Convidar nutricionista</button>`)}
    <section class="panel team-members-panel"><div class="panel-head"><div><h2>Nutricionistas</h2><p>Cada prontuário fica disponível somente para os profissionais designados.</p></div></div>${clinicians.length ? clinicians.map((person) => `<article class="team-member"><div class="avatar">${esc(person.name.trim()[0]?.toUpperCase() || '?')}</div><div class="team-member-copy"><strong>${esc(person.name)}</strong><small>${esc(person.email)} · ${person.assignedPatientCount} paciente${person.assignedPatientCount === 1 ? '' : 's'} atribuído${person.assignedPatientCount === 1 ? '' : 's'}</small></div></article>`).join('') : '<div class="empty-inline">Nenhum nutricionista foi convidado para esta clínica.</div>'}</section>
    <section class="panel team-members-panel"><div class="panel-head"><div><h2>Atribuições clínicas</h2><p>Escolha quem acompanha cada paciente na tela de cadastro.</p></div><button class="button" data-go="patients">Abrir pacientes</button></div></section>`;
  $$('[data-go]').forEach((button) => (button.onclick = () => navigate(button.dataset.go)));
}
async function invitationsPage() {
  if (!state.activeRoles.some((role) => ['owner_admin', 'operations_admin'].includes(role))) {
    $('#content').innerHTML = '<section class="empty"><h3>Acesso restrito</h3><p>Seu papel não permite criar ou acompanhar convites.</p></section>';
    return;
  }
  const url = `/api/workspaces/${encodeURIComponent(state.workspaceId)}/invitations`;
  const { invitations } = await api(url);
  const isOwner = state.activeRoles.includes('owner_admin');
  $('#content').innerHTML = `${heading('Convites', 'Convide pessoas para participar deste consultório.')}
    <section class="panel team-invite-panel"><div class="panel-head"><div><h2>Novo convite</h2><p>O convite pode ser usado uma vez e expira em sete dias. Envie o link à pessoa convidada pelo e-mail informado.</p></div></div><form id="workspace-invite-form" class="team-invite-form"><div class="field"><label for="invite-email">E-mail da pessoa</label><input id="invite-email" name="email" required type="email" autocomplete="email" placeholder="pessoa@exemplo.com"></div><div class="field"><label for="invite-role">Acesso inicial</label><select id="invite-role" name="role" required><option value="clinician">Nutricionista</option><option value="assistant">Assistente sem prontuário</option>${isOwner ? '<option value="operations_admin">Administradora operacional</option>' : ''}</select></div><button class="button primary">Criar convite</button></form><div id="invite-feedback" class="invite-feedback" role="status" aria-live="polite"></div><div id="invite-result"></div></section>
    <section class="panel team-members-panel"><div class="panel-head"><div><h2>Convites enviados</h2><p>${invitations.length} registro${invitations.length === 1 ? '' : 's'} de convite</p></div></div>${invitations.length ? invitations.map((invite) => `<article class="team-member"><div class="team-member-copy"><strong>${esc(invite.email)}</strong><small>${invite.roles.map((role) => esc(roleNames[role] || role)).join(', ')} · ${invite.status === 'pending' ? 'Pendente' : invite.status === 'accepted' ? 'Aceito' : invite.status === 'expired' ? 'Expirado' : 'Cancelado'} · vence ${dateFmt(invite.expiresAt)}</small></div>${invite.status === 'pending' ? `<button class="button subtle" data-revoke-invite="${esc(invite.id)}">Cancelar convite</button>` : ''}</article>`).join('') : '<div class="empty-inline">Nenhum convite foi criado.</div>'}</section>`;
  const inviteForm = $('#workspace-invite-form');
  inviteForm.onsubmit = async (event) => {
    event.preventDefault();
    const feedback = $('#invite-feedback');
    const result = $('#invite-result');
    const form = new FormData(event.currentTarget);
    feedback.textContent = '';
    feedback.classList.remove('is-error');
    result.innerHTML = '';
    const submit = inviteForm.querySelector('button[type="submit"], button:not([type])');
    submit.disabled = true;
    try {
      const response = await api(url, { method: 'POST', body: JSON.stringify({ email: form.get('email'), role: form.get('role') }) });
      const inviteUrl = `${location.origin}/?workspace_invite=${encodeURIComponent(response.token)}`;
      result.innerHTML = `<div class="invite-created"><strong>Convite criado · vence ${dateFmt(response.expiresAt)}</strong><input id="generated-invite-link" readonly aria-label="Link do convite" value="${esc(inviteUrl)}"><button type="button" class="button" id="copy-invite-link">Copiar link</button><p>Envie o link à pessoa convidada. Ele funciona apenas para o e-mail informado.</p></div>`;
      $('#copy-invite-link').onclick = async () => {
        const linkInput = $('#generated-invite-link');
        try {
          await navigator.clipboard.writeText(linkInput.value);
          feedback.textContent = 'Link copiado.';
        } catch {
          linkInput.focus();
          linkInput.select();
          feedback.textContent = 'Selecione e copie o link.';
        }
      };
      feedback.textContent = `Convite para ${form.get('email')} criado com sucesso.`;
      inviteForm.reset();
      const fresh = await api(url);
      $('#content').querySelector('.team-members-panel').outerHTML = `<section class="panel team-members-panel"><div class="panel-head"><div><h2>Convites enviados</h2><p>${fresh.invitations.length} registro${fresh.invitations.length === 1 ? '' : 's'} de convite</p></div></div>${fresh.invitations.map((invite) => `<article class="team-member"><div class="team-member-copy"><strong>${esc(invite.email)}</strong><small>${invite.roles.map((role) => esc(roleNames[role] || role)).join(', ')} · ${invite.status === 'pending' ? 'Pendente' : invite.status === 'accepted' ? 'Aceito' : invite.status === 'expired' ? 'Expirado' : 'Cancelado'} · vence ${dateFmt(invite.expiresAt)}</small></div>${invite.status === 'pending' ? `<button class="button subtle" data-revoke-invite="${esc(invite.id)}">Cancelar convite</button>` : ''}</article>`).join('')}</section>`;
      bindInvitationRevocation(url);
    } catch (error) {
      feedback.textContent = error.message || 'Não foi possível criar o convite.';
      feedback.classList.add('is-error');
    } finally {
      submit.disabled = false;
    }
  };
  bindInvitationRevocation(url);
}
function bindInvitationRevocation(url) {
  $$('[data-revoke-invite]').forEach((button) => (button.onclick = async () => {
    button.disabled = true;
    try {
      await api(`${url}/${encodeURIComponent(button.dataset.revokeInvite)}`, { method: 'DELETE' });
      await invitationsPage();
    } catch (error) {
      button.disabled = false;
      const feedback = $('#invite-feedback');
      if (feedback) feedback.textContent = error.message;
    }
  }));
}
async function clinicSettingsPage() {
  if (!state.activeRoles.includes('owner_admin')) {
    $('#content').innerHTML = '<section class="empty"><h3>Acesso restrito</h3><p>Somente a proprietária pode alterar os dados do consultório.</p></section>';
    return;
  }
  const workspace = state.workspaces.find((item) => item.id === state.workspaceId);
  $('#content').innerHTML = `${heading('Clínica ou consultório', 'Atualize os dados deste consultório.')}
    <section class="panel team-invite-panel"><form id="clinic-settings-form"><div class="field"><label for="clinic-name">Nome do consultório</label><input id="clinic-name" name="name" maxlength="120" required value="${esc(workspace.name)}"></div><p class="row-secondary">Tipo: ${workspace.type === 'clinic' ? 'Clínica ou consultório' : 'Consultório individual'}</p><div class="modal-actions"><button class="button primary">Salvar alterações</button></div><p id="clinic-settings-feedback" class="form-error" role="status"></p></form></section>`;
  $('#clinic-settings-form').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const result = await api(`/api/workspaces/${encodeURIComponent(state.workspaceId)}`, { method: 'PATCH', body: JSON.stringify({ name: new FormData(event.currentTarget).get('name') }) });
      workspace.name = result.workspace.name;
      $('#workspace-current').textContent = contextDisplay({ workspace, experience: state.activeExperience, roles: state.activeRoles }).label;
      $('#clinic-settings-feedback').textContent = 'Nome atualizado.';
    } catch (error) { $('#clinic-settings-feedback').textContent = error.message; }
  };
}
async function permissionsPage() {
  const { roles } = await api(`/api/workspaces/${encodeURIComponent(state.workspaceId)}/roles`);
  $('#content').innerHTML = `${heading('Papéis e permissões', 'Veja o que cada função pode fazer no consultório.')}
    <section class="panel team-members-panel"><div class="panel-head"><div><h2>Acessos por função</h2><p>Mesmo com acesso clínico, cada profissional só vê os prontuários que lhe foram atribuídos.</p></div></div><div class="permission-role-list">${roles.map((role) => `<article class="permission-role"><h3>${esc(role.name)}</h3><ul>${role.permissions.map((permission) => `<li>${esc(permission)}</li>`).join('')}</ul></article>`).join('')}</div><button class="button" data-go="team">Gerenciar acessos da equipe</button></section>`;
  $$('[data-go]').forEach((button) => (button.onclick = () => navigate(button.dataset.go)));
}
function availableContexts() {
  return state.workspaces.flatMap((workspace) => {
    const roles = workspace.roles || [];
    const contexts = [];
    if (roles.includes('clinician'))
      contexts.push({ workspaceId: workspace.id, workspace, experience: 'clinical', roles });
    if (roles.some((role) => ['owner_admin', 'operations_admin', 'assistant'].includes(role)))
      contexts.push({ workspaceId: workspace.id, workspace, experience: 'administrative', roles });
    return contexts;
  });
}
function contextDisplay(context) {
  if (context.experience === 'clinical')
    return {
      title: `Nutricionista — ${state.user.name}`,
      subtitle: context.workspace.name,
      label: `Nutricionista — ${state.user.name} · ${context.workspace.name}`,
      icon: '♡',
    };
  const title = context.workspace.name;
  return {
    title,
    subtitle: `Área administrativa · ${context.roles.map((role) => roleNames[role] || role).join(', ')}`,
    label: title,
    icon: '⌂',
  };
}
function contextSelector() {
  showOnboardingShell();
  const contexts = availableContexts();
  $('#content').innerHTML = `<section class="panel context-selector-panel"><p class="eyebrow">SELEÇÃO DE PERFIL</p><h1>Em qual perfil você deseja entrar?</h1><p class="muted">Você pode trocar de perfil sem sair da conta. O acesso aos prontuários depende da sua função e dos pacientes atribuídos a você.</p>${contexts.length ? `<div class="context-options">${contexts.map((context, index) => {
    const display = contextDisplay(context);
    return `<article class="context-option"><span class="context-option-icon" aria-hidden="true">${display.icon}</span><div><h2>${esc(display.title)}</h2><p>${esc(display.subtitle)}</p></div><button class="button primary" data-context-index="${index}">Entrar neste perfil</button></article>`;
  }).join('')}</div>` : `<div class="empty-inline">Não encontramos um perfil ativo para sua conta. Peça à responsável pelo consultório para conferir seu acesso.</div>`}<p class="context-selector-error" id="context-selector-error" role="alert"></p></section>`;
  $$('[data-context-index]').forEach((button) => (button.onclick = async () => {
    button.disabled = true;
    try {
      const context = contexts[Number(button.dataset.contextIndex)];
      const selected = await api('/api/workspaces/select', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: context.workspaceId, experience: context.experience }),
      });
      await renderWorkspaceApp(selected);
    } catch (error) {
      $('#context-selector-error').textContent = error.message;
      button.disabled = false;
    }
  }));
}
async function renderWorkspaceApp(selected) {
  state.workspaceId = selected.workspace.id;
  state.activeExperience = selected.experience;
  state.activeRoles = selected.membership.roles;
  localStorage.setItem('nutritrack-workspace-id', state.workspaceId);
  const workspace = state.workspaces.find((item) => item.id === state.workspaceId);
  const roles = selected.membership.roles;
  const isClinical = state.activeExperience === 'clinical';
  const canManageMembers = roles.some((role) => ['owner_admin', 'operations_admin'].includes(role));
  const canCreatePatients = roles.some((role) => ['owner_admin', 'operations_admin', 'assistant', 'clinician'].includes(role));
  $('.workspace-switcher').hidden = false;
  $('.nav-caption').hidden = false;
  $('#main-nav').hidden = false;
  $('.privacy-card').hidden = false;
  $('.topbar').hidden = false;
  $('#workspace-current').textContent = contextDisplay({ workspace, experience: state.activeExperience, roles }).label;
  $('#switch-context').onclick = () => contextSelector();
  const legacyPreview = await api('/api/workspaces/legacy-preview');
  $('#migrate-legacy').hidden = !legacyPreview.hasLegacyRecords || isClinical;
  $('#migrate-legacy').onclick = () => legacyWorkspaceOnboarding();
  $('#new-workspace').hidden = isClinical || !roles.includes('owner_admin');
  const items = [['dashboard', '⌁', 'Visão geral']];
  if (isClinical) {
    items.push(['patients', '♧', 'Pacientes']);
    items.push(['agenda', '▦', 'Agenda']);
    items.push(['assessments', '♡', 'Avaliações']);
    items.push(['goals', '◎', 'Metas']);
    items.push(['meal-plans', '▤', 'Planos alimentares']);
    $('.nav-caption').textContent = 'ATENDIMENTO CLÍNICO';
  } else {
    if (roles.some((role) => ['owner_admin', 'operations_admin', 'assistant'].includes(role)))
      items.push(['patients', '♧', 'Pacientes']);
    if (roles.some((role) => ['owner_admin', 'operations_admin', 'assistant'].includes(role)))
      items.push(['agenda', '▦', 'Agenda']);
    if (roles.some((role) => ['owner_admin', 'operations_admin'].includes(role)))
      items.push(['professionals', '♙', 'Profissionais']);
    if (canManageMembers) {
      items.push(['team', '♙', 'Equipe']);
      items.push(['invitations', '✉', 'Convites']);
      items.push(['permissions', '⚿', 'Permissões']);
    }
    if (roles.includes('owner_admin')) items.push(['clinic', '⌂', 'Clínica ou consultório']);
    $('.nav-caption').textContent = 'ADMINISTRAÇÃO';
  }
  $('#main-nav').innerHTML = items.map(([page, icon, label]) => `<button class="nav-item" data-page="${page}"><span class="nav-icon">${icon}</span>${label}${page === 'patients' ? '<b id="patient-badge">0</b>' : ''}</button>`).join('');
  $$('.nav-item').forEach((item) => (item.onclick = () => navigate(item.dataset.page)));
  $('#top-new-patient').hidden = !canCreatePatients;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#user-name').textContent = state.user.name;
  $('#user-email').textContent = state.user.email;
  $('#user-avatar').textContent = state.user.name.trim()[0].toUpperCase();
  $('#greeting').textContent = `Olá, ${state.user.name.trim().split(/\s+/)[0]}`;
  $('#today-label').textContent = new Date().toLocaleDateString('pt-BR', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  await loadPatients();
  await navigate('dashboard');
}
async function showApp() {
  let account = await api('/api/me');
  const pendingInvite = sessionStorage.getItem('nutritrack-workspace-invite');
  if (pendingInvite) {
    try {
      const result = await api('/api/workspace-invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token: pendingInvite }),
      });
      sessionStorage.removeItem('nutritrack-workspace-invite');
      history.replaceState(null, '', location.pathname + location.hash);
      account = await api('/api/me');
      localStorage.setItem('nutritrack-workspace-id', result.workspace.id);
    } catch (error) {
      toast(error.message, true);
      sessionStorage.removeItem('nutritrack-workspace-invite');
    }
  }
  state.user = account.user;
  state.workspaces = account.workspaces || [];
  if (!state.workspaces.length) {
    const legacy = await api('/api/workspaces/legacy-preview');
    if (legacy.hasLegacyRecords) await legacyWorkspaceOnboarding();
    else await workspaceSetup();
    return;
  }
  $('#new-workspace').onclick = () => createWorkspaceModal();
  $('#user-name').textContent = state.user.name;
  $('#user-email').textContent = state.user.email;
  $('#user-avatar').textContent = state.user.name.trim()[0].toUpperCase();
  contextSelector();
}
function refreshAuthProfileFields() {
  const registering = state.authMode === 'register';
  const invited = !!sessionStorage.getItem('nutritrack-workspace-invite');
  $('#auth-profile-fields').hidden = !registering || invited;
  $('#auth-invite-notice').hidden = !registering || !invited;
  const clinic = registering && !invited && $('#auth-profile-type').value === 'clinic';
  $('#auth-workspace-name-field').hidden = !clinic;
  $('#auth-workspace-name').required = clinic;
  $('#auth-clinician-option').hidden = !clinic;
  if (!clinic) $('#auth-clinician').checked = false;
}
$('#auth-profile-type').onchange = refreshAuthProfileFields;
$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();
  $('#auth-error').textContent = '';
  const endpoint = state.authMode === 'login' ? '/api/login' : '/api/register',
    payload = { email: $('#auth-email').value, password: $('#auth-password').value };
  if (state.authMode === 'register') {
    payload.name = $('#auth-name').value;
    if (!sessionStorage.getItem('nutritrack-workspace-invite')) {
      payload.profileType = $('#auth-profile-type').value;
      if (payload.profileType === 'clinic') {
        payload.workspaceName = $('#auth-workspace-name').value;
        payload.clinician = $('#auth-clinician').checked;
      }
    }
  }
  try {
    await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    await showApp();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
};
$('#auth-toggle').onclick = () => {
  state.authMode = state.authMode === 'login' ? 'register' : 'login';
  const reg = state.authMode === 'register';
  $('#auth-name').hidden = !reg;
  $('#auth-name').required = reg;
  $('#auth-password').autocomplete = reg ? 'new-password' : 'current-password';
  $('#auth-title').textContent = reg ? 'Criar sua conta profissional' : 'Bem-vinda ao NutriTrack';
  $('#auth-subtitle').textContent = reg
    ? 'Comece a organizar seus acompanhamentos.'
    : 'Entre para organizar seus acompanhamentos.';
  $('#auth-submit').textContent = reg ? 'Criar conta' : 'Entrar';
  $('#auth-toggle-label').textContent = reg ? 'Já tem uma conta?' : 'Ainda não tem uma conta?';
  $('#auth-toggle').textContent = reg ? 'Entrar' : 'Criar conta';
  refreshAuthProfileFields();
};
const workspaceInviteToken = new URLSearchParams(location.search).get('workspace_invite');
if (workspaceInviteToken) {
  sessionStorage.setItem('nutritrack-workspace-invite', workspaceInviteToken);
  history.replaceState(null, '', location.pathname + location.hash);
}
$('#logout').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
};
$('#top-new-patient').onclick = () => patientModal();
$$('.nav-item').forEach((x) => (x.onclick = () => navigate(x.dataset.page)));
$('#mobile-menu').onclick = () => {
  const open = $('.sidebar').classList.toggle('open');
  $('#mobile-menu').setAttribute('aria-expanded', String(open));
};
document.addEventListener('click', (e) => {
  if (
    $('.sidebar').classList.contains('open') &&
    !$('.sidebar').contains(e.target) &&
    !$('#mobile-menu').contains(e.target)
  ) {
    $('.sidebar').classList.remove('open');
    $('#mobile-menu').setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener(
  'toggle',
  async (event) => {
    const details = event.target;
    if (!details.matches?.('details.version-history') || !details.open || details.dataset.loaded)
      return;
    details.dataset.loaded = 'loading';
    const content = details.querySelector('.version-history-content');
    content.innerHTML = '<small>Carregando histórico…</small>';
    try {
      const { mealPlan } = await api(
        `/api/meal-plans/${encodeURIComponent(details.dataset.planId)}`,
      );
      const versions = Array.isArray(mealPlan.versions) ? mealPlan.versions : [];
      content.innerHTML = versions.length
        ? versions
            .slice()
            .reverse()
            .map(
              (v) =>
                `<div class="version-row"><strong>Versão ${v.number}</strong><span class="plan-status ${v.status === 'published' ? 'published' : ''}">${v.status === 'published' ? 'Publicada' : 'Rascunho'}</span><small>${dateFmt(v.createdAt)} · ${(v.meals || []).length} refeições${v.publishedAt ? ` · publicada em ${dateFmt(v.publishedAt)}` : ''}</small></div>`,
            )
            .join('')
        : '<small>Nenhuma versão registrada.</small>';
      details.dataset.loaded = 'true';
    } catch (error) {
      details.dataset.loaded = '';
      content.innerHTML = `<small>${esc(error.message || 'Não foi possível carregar o histórico.')}</small>`;
    }
  },
  true,
);
if (!location.pathname.startsWith('/paciente'))
  showApp().catch(() => {
    $('#auth').hidden = false;
    $('#app').hidden = true;
  });
if (location.protocol === 'file:') $('#runtime-notice').hidden = false;
