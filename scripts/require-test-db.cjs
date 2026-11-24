const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  process.env.TEST_DATABASE_CONFIRM !== 'disposable' ||
  !new URL(url).pathname.endsWith('_test')
)
  throw Error(
    'CI exige TEST_DATABASE_URL descartável terminado em _test e TEST_DATABASE_CONFIRM=disposable. Nenhum teste PG pode ser ignorado.',
  );
