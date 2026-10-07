/**
 * Importar este módulo (por efecto) aísla los tests de las variables de
 * entorno que cambian el resultado según dónde se corran; registra los hooks
 * a nivel raíz del archivo de test que lo importa.
 */
// - BOARD_LANGUAGE: quien lo tenga exportado en su terminal (ej. "en") vería
//   fallar los casos que esperan el idioma por defecto (es).
// - GITHUB_REPOSITORY: GitHub Actions lo define siempre, y `obtenerOwnerRepo`
//   lo prefiere al `gh repo view` falso de los tests; sin esto, los enlaces
//   "Documento" salen con el repo real en CI y con owner/repo en local.
const VARIABLES_AISLADAS = ['BOARD_LANGUAGE', 'GITHUB_REPOSITORY'] as const;
const valoresOriginales = new Map(VARIABLES_AISLADAS.map((v) => [v, process.env[v]]));
beforeEach(() => {
    for (const variable of VARIABLES_AISLADAS) delete process.env[variable];
});
afterAll(() => {
    for (const [variable, original] of valoresOriginales) {
        if (original === undefined) delete process.env[variable];
        else process.env[variable] = original;
    }
});
