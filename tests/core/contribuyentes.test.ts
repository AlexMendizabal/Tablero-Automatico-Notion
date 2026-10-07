/**
 * Tests de la normalización de contribuyentes: login de GitHub desde los
 * emails noreply, exclusión de bots, nombres válidos para una opción de
 * multi-select de Notion, deduplicación y orden.
 */
import {
    type AutorCommit,
    calcularContribuyentes,
    esBot,
    identidadContribuyente,
    loginDeEmailNoreply,
    normalizarNombreOpcion,
} from '../../src/core/contribuyentes';

const autor = (nombre: string, email: string, coautores: AutorCommit['coautores'] = []): AutorCommit => ({
    nombre,
    email,
    coautores,
});

describe('loginDeEmailNoreply', () => {
    test.each([
        ['12345+octocat@users.noreply.github.com', 'octocat'],
        ['octocat@users.noreply.github.com', 'octocat'],
        ['12345+Octo-Cat@Users.NoReply.GitHub.com', 'Octo-Cat'],
        ['  12345+octocat@users.noreply.github.com  ', 'octocat'],
    ])('%s → %s', (email, login) => {
        expect(loginDeEmailNoreply(email)).toBe(login);
    });

    test.each(['octocat@gmail.com', 'noreply@github.com', 'octocat@users.noreply.github.com.evil.com', '', '@users.noreply.github.com'])(
        '%s no es un noreply de usuario',
        (email) => {
            expect(loginDeEmailNoreply(email)).toBeNull();
        },
    );
});

describe('esBot', () => {
    test.each(['dependabot[bot]', 'github-actions[bot]', 'Renovate[BOT]', 'dependabot', 'dependabot-preview', 'app/dependabot', 'app/renovate'])(
        '%s es un bot',
        (valor) => {
            expect(esBot(valor)).toBe(true);
        },
    );

    test.each(['octocat', 'Ana Pérez', 'bot', 'robot-ana', 'dependable'])('%s no es un bot', (valor) => {
        expect(esBot(valor)).toBe(false);
    });
});

describe('normalizarNombreOpcion', () => {
    test('cambia las comas por espacios (Notion no las acepta en una opción) y colapsa espacios', () => {
        expect(normalizarNombreOpcion('  Pérez,  Ana ,')).toBe('Pérez Ana');
    });

    test('recorta a 100 caracteres sin partir un carácter fuera del plano básico', () => {
        expect(normalizarNombreOpcion('a'.repeat(150))).toBe('a'.repeat(100));
        const conEmoji = 'a'.repeat(99) + '😀' + 'b';
        expect(Array.from(normalizarNombreOpcion(conEmoji))).toHaveLength(100);
        expect(normalizarNombreOpcion(conEmoji).endsWith('😀')).toBe(true);
    });
});

describe('identidadContribuyente', () => {
    test('un email noreply de GitHub da el login, aunque el nombre sea otro', () => {
        expect(identidadContribuyente({ nombre: 'Ana Pérez', email: '9+anap@users.noreply.github.com' })).toBe('anap');
    });

    test('con otro email, el nombre (ya con .mailmap aplicado por git) normalizado', () => {
        expect(identidadContribuyente({ nombre: '  Ana   Pérez ', email: 'ana@example.com' })).toBe('Ana Pérez');
    });

    test.each([
        { nombre: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com' },
        { nombre: 'GitHub', email: 'noreply@github.com' },
        { nombre: 'github-actions[bot]', email: 'actions@example.com' },
        { nombre: 'dependabot', email: 'support@dependabot.com' },
    ])('excluye bots: $nombre <$email>', (identidad) => {
        expect(identidadContribuyente(identidad)).toBeNull();
    });

    test('un nombre vacío (o solo comas y espacios) no da contribuyente', () => {
        expect(identidadContribuyente({ nombre: ' , ', email: 'x@example.com' })).toBeNull();
    });
});

describe('calcularContribuyentes', () => {
    test('une autores de PRs, de commits y coautores, sin bots, deduplicados y ordenados', () => {
        expect(
            calcularContribuyentes({
                loginsPrs: ['octocat', 'dependabot[bot]', 'app/renovate'],
                commits: [
                    autor('Zoe', 'zoe@example.com', [{ nombre: 'Bruno', email: 'bruno@example.com' }]),
                    autor('The Octocat', '1+octocat@users.noreply.github.com'),
                    autor('github-actions[bot]', '41898282+github-actions[bot]@users.noreply.github.com'),
                ],
            }),
        ).toEqual(['Bruno', 'octocat', 'Zoe']);
    });

    test('la deduplicación no distingue mayúsculas y conserva la primera grafía vista (PRs primero)', () => {
        expect(
            calcularContribuyentes({
                loginsPrs: ['OctoCat'],
                commits: [autor('x', 'octocat@users.noreply.github.com'), autor('ana', 'a@x.com'), autor('Ana', 'b@x.com')],
            }),
        ).toEqual(['ana', 'OctoCat']);
    });

    test('el orden es determinístico y alfabético sin importar la capitalización ni los acentos', () => {
        expect(
            calcularContribuyentes({
                loginsPrs: [],
                commits: ['carla', 'Ángel', 'bruno', 'Ana'].map((nombre) => autor(nombre, `${nombre}@x.com`)),
            }),
        ).toEqual(['Ana', 'Ángel', 'bruno', 'carla']);
    });

    test('los logins de PR también se normalizan para Notion (comas, largo)', () => {
        expect(calcularContribuyentes({ loginsPrs: [' raro,login '], commits: [] })).toEqual(['raro login']);
    });

    test('sin fuentes, ninguno', () => {
        expect(calcularContribuyentes({ loginsPrs: [], commits: [] })).toEqual([]);
    });
});
