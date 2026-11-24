if (['/privacy', '/terms'].includes(location.pathname)) {
  document.querySelector('#auth').hidden = true;
  document.querySelector('#app').hidden = true;
  const main = document.createElement('main');
  main.className = 'portal-content';
  const title = document.createElement('h1');
  title.textContent = location.pathname === '/privacy' ? 'Aviso de privacidade' : 'Termos de uso';
  main.append(title);
  const content = document.createElement('pre');
  content.className = 'legal-document';
  content.setAttribute('role', 'document');
  main.append(content);
  const back = document.createElement('a');
  back.href = '/';
  back.textContent = 'Voltar ao NutriTrack';
  main.append(back);
  document.body.append(main);
  fetch('/api/legal/' + (location.pathname === '/privacy' ? 'privacy' : 'terms'))
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Documento indisponível.');
      content.textContent = data.text;
    })
    .catch((error) => {
      content.textContent = error.message;
    });
}
