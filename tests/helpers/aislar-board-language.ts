/**
 * Importar este módulo (por efecto) aísla los tests del BOARD_LANGUAGE del
 * entorno; registra los hooks a nivel raíz del archivo de test que lo importa.
 */
// Aísla los tests del BOARD_LANGUAGE del entorno: sin esto, quien tenga
// BOARD_LANGUAGE=en exportado en su terminal ve fallar los casos que esperan
// el idioma por defecto (es).
const boardLanguageOriginal = process.env.BOARD_LANGUAGE;
beforeEach(() => {
    delete process.env.BOARD_LANGUAGE;
});
afterAll(() => {
    if (boardLanguageOriginal === undefined) delete process.env.BOARD_LANGUAGE;
    else process.env.BOARD_LANGUAGE = boardLanguageOriginal;
});
