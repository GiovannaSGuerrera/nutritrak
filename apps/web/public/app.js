const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
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
  const r = await fetch(url, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
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
    const data = Object.fromEntries(new FormData(e.currentTarget));
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
  } catch (error) {
    const expired = error.status === 401;
    $('#content').innerHTML =
      `<section class="empty"><div class="empty-mark">!</div><h3>${expired ? 'Sua sessão expirou' : 'Não foi possível carregar esta seção'}</h3><p>${expired ? 'Entre novamente para continuar.' : esc(error.message || 'Verifique a conexão e tente de novo.')}</p><button class="button primary" id="retry-page">${expired ? 'Voltar para entrar' : 'Tentar novamente'}</button></section>`;
    $('#retry-page').onclick = () => (expired ? location.reload() : navigate(page));
  }
}
async function dashboard() {
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
    `<div class="dashboard-heading"><div><p class="eyebrow">NUTRITRACK PRO</p><h1>Visão geral</h1><p>Uma visão clara para cuidar melhor de cada jornada.</p></div><button class="button outline-button" data-go="patients">Ver pacientes <span>›</span></button></div><section class="stats">${cards.map((c) => `<article class="stat-card"><div class="stat-top">${c[0]}<span class="stat-icon ${c[4]}">${c[3]}</span></div><div class="stat-value">${c[1]}</div><div class="stat-hint">${c[2]}</div></article>`).join('')}</section><section class="panel chart-panel"><div class="panel-head"><div><h2>Novos pacientes</h2><p>Cadastros por mês, calculados do seu histórico</p></div><span class="period-pill">Últimos 6 meses</span></div>${d.newPatientsByMonth.some((m) => m.total > 0) ? newPatientsChart(d.newPatientsByMonth) : `<div class="chart-empty"><div class="chart-empty-icon">♧</div><strong>${chartEmpty}</strong><p>Os totais mensais são calculados a partir do histórico<br class="desktop-break"> de cadastros do seu consultório.</p></div>`}</section><div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Próximas consultas</h2><p>Consultas agendadas em breve</p></div><button class="text-action" data-go="agenda">Ver agenda →</button></div>${d.upcoming.length ? d.upcoming.map((a) => `<div class="appointment-row"><div class="time-block">${timeFmt(a.start)}</div><div><div class="row-primary">${esc(a.patientName)}</div><div class="row-secondary">${dateFmt(a.start)} · ${esc(a.type)}</div></div><span class="status-pill">Agendada</span></div>`).join('') : `<div class="empty-inline"><strong>Nenhuma consulta próxima</strong>Agendamentos futuros aparecerão aqui.</div>`}</section><section class="panel"><div class="panel-head"><div><h2>Atividade recente</h2><p>Movimentações do consultório</p></div></div>${d.recent.length ? d.recent.map((a) => `<div class="activity-row"><div class="avatar">${a.type === 'patient' ? '♧' : '•'}</div><div><div class="row-primary">${{ patient_created: 'Paciente cadastrado', patient_updated: 'Cadastro atualizado', patient_portal_activated: 'Portal do paciente ativado', assessment_created: 'Avaliação registrada', appointment_created: 'Consulta agendada', goal_created: 'Meta criada' }[a.action] || 'Atividade registrada'}</div><div class="row-secondary">${dateFmt(a.at)}</div></div></div>`).join('') : `<div class="empty-inline"><strong>Nenhuma atividade ainda</strong>Suas movimentações aparecerão aqui.</div>`}</section></div><div class="action-grid"><button class="quick-action" id="quick-patient"><span>＋</span><strong>Cadastrar paciente</strong><small>Inicie um acompanhamento</small></button><button class="quick-action" id="quick-appointment"><span>▦</span><strong>Agendar consulta</strong><small>Organize seus próximos horários</small></button><button class="quick-action" id="quick-assessment"><span>↗</span><strong>Registrar avaliação</strong><small>Atualize medidas corporais</small></button></div>`;
  $('#quick-patient').onclick = () => patientModal();
  $('#quick-appointment').onclick = () => appointmentModal();
  $('#quick-assessment').onclick = () => assessmentModal();
  $$('[data-go]').forEach((x) => (x.onclick = () => navigate(x.dataset.go)));
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
  openModal(
    p ? 'Editar paciente' : 'Cadastrar paciente',
    p ? 'Atualize os dados cadastrais.' : 'Informações mínimas para iniciar o acompanhamento.',
    `${field('name', 'Nome completo', 'text', { required: true, wide: true, placeholder: 'Nome do paciente' })}${field('email', 'E-mail', 'email')}${field('phone', 'Telefone', 'tel')}${field('birthDate', 'Data de nascimento', 'date')}${field('status', 'Status', 'select', { options: ['Ativo', 'Em pausa', 'Arquivado'] })}${field('objective', 'Objetivo principal', 'textarea', { wide: true, placeholder: 'Opcional' })}${field('clinicalNotes', 'Observações profissionais', 'textarea', { wide: true, placeholder: 'Use apenas informações necessárias ao atendimento.' })}`,
    'Salvar paciente',
    async (d) => {
      if (p) await api(`/api/patients/${p.id}`, { method: 'PATCH', body: JSON.stringify(d) });
      else await api('/api/patients', { method: 'POST', body: JSON.stringify(d) });
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
  $('#add-assessment').onclick = () => assessmentModal(p.id);
  const portalButton = document.createElement('button');
  const patientHasEmail = /^\S+@\S+\.\S+$/.test(p.email || '');
  portalButton.className = d.portal?.enabled ? 'button portal-enabled' : 'button subtle';
  portalButton.textContent = d.portal?.enabled
    ? 'Portal ativo'
    : patientHasEmail
      ? '＋ Convidar para o portal'
      : 'Informe e-mail para convidar';
  portalButton.disabled = !!d.portal?.enabled || !patientHasEmail;
  if (!d.portal?.enabled && patientHasEmail)
    portalButton.onclick = () => createPatientInvitation(p.id, p.name);
  if (!patientHasEmail && !d.portal?.enabled)
    portalButton.title = 'Cadastre um e-mail válido no perfil do paciente antes do convite.';
  const profileActions = $('.page-heading>div:last-child');
  profileActions.classList.add('patient-profile-actions');
  profileActions.prepend(portalButton);
  if (d.portal?.enabled) {
    const resetButton = document.createElement('button');
    resetButton.className = 'button subtle';
    resetButton.textContent = 'Redefinir senha do portal';
    resetButton.onclick = () => createPatientPasswordReset(p.id, p.name);
    profileActions.prepend(resetButton);
  }
  $$('[data-tab]').forEach(
    (x) =>
      (x.onclick = () => {
        $$('[data-tab]').forEach((y) => y.classList.toggle('active', x === y));
        renderPatientTab(x.dataset.tab);
      }),
  );
  renderPatientTab('overview');
}
function renderPatientTab(tab) {
  const d = state.patientData,
    p = d.patient,
    ass = d.assessments,
    latest = ass[0];
  const box = $('#patient-tab-content');
  if (tab === 'overview') {
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
async function showApp() {
  state.user = (await api('/api/me')).user;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#user-name').textContent = state.user.name;
  $('#user-email').textContent = state.user.email;
  $('#user-avatar').textContent = state.user.name.trim()[0].toUpperCase();
  $('#greeting').textContent = `Olá, ${state.user.name.trim().split(/\s+/)[0]}`;
  $('#today-label').textContent = new Date().toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  await loadPatients();
  await navigate('dashboard');
}
$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();
  $('#auth-error').textContent = '';
  const endpoint = state.authMode === 'login' ? '/api/login' : '/api/register',
    payload = { email: $('#auth-email').value, password: $('#auth-password').value };
  if (state.authMode === 'register') payload.name = $('#auth-name').value;
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
};
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
