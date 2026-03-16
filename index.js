'use strict';

// ============================================================
//  DISBOARD AUTO BUMPER - 3 TOKEN / 3 SERVER
//  - Token 1 bumpa, 40 min dopo Token 2, 40 min dopo Token 3
//  - Ciclo totale: ogni 2 ore (40+40+40 = 120 min)
//  - Delay random 1-10 min dopo il ciclo completo
//  - Retry automatico su errori
//  - Log dettagliato
// ============================================================

const { Client } = require('discord.js-selfbot-v13');

// ─── CONFIG ────────────────────────────────────────────────
const ACCOUNTS = [
    { token: process.env.TOKEN_1, channelId: process.env.CHANNEL_ID_1, label: 'Account 1' },
    { token: process.env.TOKEN_2, channelId: process.env.CHANNEL_ID_2, label: 'Account 2' },
    { token: process.env.TOKEN_3, channelId: process.env.CHANNEL_ID_3, label: 'Account 3' },
];

const DISBOARD_ID    = '302050872383242240';
const INTERVAL_MS    = 40 * 60 * 1000; // 40 minuti tra ogni bump
const DELAY_MIN_MS   = 1  * 60 * 1000;
const DELAY_MAX_MS   = 10 * 60 * 1000;
const MAX_RETRIES    = 5;
const RETRY_DELAY_MS = 30 * 1000;
// ───────────────────────────────────────────────────────────

// ─── UTILITIES ─────────────────────────────────────────────
function log(level, label, msg) {
    const time  = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
    const icons = { INFO: '📋', OK: '✅', WARN: '⚠️ ', ERROR: '❌', WAIT: '⏳', BUMP: '🚀' };
    console.log(`[${time}] ${icons[level] || '•'} [${level}] [${label}] ${msg}`);
}

function randomDelay() {
    return Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1)) + DELAY_MIN_MS;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}
// ───────────────────────────────────────────────────────────

// ─── VALIDAZIONE ───────────────────────────────────────────
ACCOUNTS.forEach((acc, i) => {
    if (!acc.token)     { console.error(`❌ TOKEN_${i+1} mancante!`);     process.exit(1); }
    if (!acc.channelId) { console.error(`❌ CHANNEL_ID_${i+1} mancante!`); process.exit(1); }
});
// ───────────────────────────────────────────────────────────

// ─── STATS ─────────────────────────────────────────────────
const stats = ACCOUNTS.map(a => ({ label: a.label, bumps: 0, fails: 0 }));
// ───────────────────────────────────────────────────────────

// ─── CREA CLIENT ───────────────────────────────────────────
const clients = ACCOUNTS.map(acc => {
    const client = new Client({ checkUpdate: false });
    client.on('ready', () => log('OK',    acc.label, `Connesso come ${client.user.tag}`));
    client.on('error', e  => log('ERROR', acc.label, `Errore client: ${e.message}`));
    client.on('warn',  m  => log('WARN',  acc.label, m));
    return client;
});
// ───────────────────────────────────────────────────────────

// ─── LOGIN ─────────────────────────────────────────────────
async function loginAll() {
    for (let i = 0; i < ACCOUNTS.length; i++) {
        try {
            log('INFO', ACCOUNTS[i].label, 'Login...');
            await clients[i].login(ACCOUNTS[i].token);
            await sleep(3000);
        } catch (e) {
            log('ERROR', ACCOUNTS[i].label, `Login fallito: ${e.message}`);
            process.exit(1);
        }
    }
    log('INFO', 'SISTEMA', '✅ Tutti connessi!');
}
// ───────────────────────────────────────────────────────────

// ─── BUMP ──────────────────────────────────────────────────
async function doBump(i) {
    const acc = ACCOUNTS[i], client = clients[i], stat = stats[i];

    let channel = client.channels.cache.get(acc.channelId);
    if (!channel) {
        try { channel = await client.channels.fetch(acc.channelId); }
        catch (e) { log('ERROR', acc.label, `Fetch canale fallito: ${e.message}`); return { success: false, fatal: false }; }
    }
    if (!channel) { log('ERROR', acc.label, 'Canale non trovato!'); return { success: false, fatal: true }; }

    log('BUMP', acc.label, `Eseguo /bump in #${channel.name} (${channel.guild?.name})...`);

    try {
        await channel.sendSlash(DISBOARD_ID, 'bump');
        stat.bumps++;
        log('OK', acc.label, `Bump #${stat.bumps} eseguito! (${new Date().toLocaleString('it-IT')})`);
        return { success: true, fatal: false };
    } catch (e) {
        const m = e.message || '';
        log('ERROR', acc.label, `Errore: ${m}`);
        if (m.includes('cooldown') || m.includes('wait')) { await sleep(5 * 60 * 1000); return { success: false, fatal: false }; }
        if (m.includes('Missing Permissions'))             { return { success: false, fatal: true }; }
        if (m.includes('Unknown Channel'))                 { return { success: false, fatal: true }; }
        if (m.includes('401') || m.includes('Invalid token')) { log('ERROR', acc.label, 'Token scaduto! Aggiorna in Railway.'); return { success: false, fatal: true }; }
        return { success: false, fatal: false };
    }
}

async function bumpWithRetry(i) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 1) { log('WARN', ACCOUNTS[i].label, `Tentativo ${attempt}/${MAX_RETRIES}...`); await sleep(RETRY_DELAY_MS); }
        const { success, fatal } = await doBump(i);
        if (success) return;
        if (fatal)   { process.exit(1); }
    }
    stats[i].fails++;
    log('ERROR', ACCOUNTS[i].label, `Bump fallito dopo ${MAX_RETRIES} tentativi.`);
}
// ───────────────────────────────────────────────────────────

// ─── LOOP PRINCIPALE ────────────────────────────────────────
async function mainLoop() {
    log('INFO', 'SISTEMA', '═══════════════════════════════════════');
    log('INFO', 'SISTEMA', '   DISBOARD AUTO BUMPER 3x AVVIATO    ');
    log('INFO', 'SISTEMA', '   Intervallo tra bump: 40 minuti     ');
    log('INFO', 'SISTEMA', '   Ciclo completo: ~2 ore             ');
    log('INFO', 'SISTEMA', '═══════════════════════════════════════');

    await sleep(5000);
    let cycle = 0;

    while (true) {
        cycle++;
        log('INFO', 'SISTEMA', `─── CICLO #${cycle} ───`);

        for (let i = 0; i < ACCOUNTS.length; i++) {
            await bumpWithRetry(i);

            if (i < ACCOUNTS.length - 1) {
                const next = new Date(Date.now() + INTERVAL_MS).toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
                log('WAIT', 'SISTEMA', `Prossimo bump (${ACCOUNTS[i+1].label}) tra ${formatTime(INTERVAL_MS)} (alle ${next})`);
                await sleep(INTERVAL_MS);
            }
        }

        // Stats fine ciclo
        log('INFO', 'SISTEMA', '─── STATS ───');
        stats.forEach(s => log('INFO', s.label, `✅ ${s.bumps} bumps | ❌ ${s.fails} falliti`));

        // Delay random prima del prossimo ciclo
        const extra = randomDelay();
        const next  = new Date(Date.now() + extra).toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
        log('WAIT', 'SISTEMA', `Ciclo completato! Prossimo tra ${formatTime(extra)} (alle ${next})`);
        await sleep(extra);
    }
}
// ───────────────────────────────────────────────────────────

process.on('unhandledRejection', e => console.error('❌ Rejection:', e?.message));
process.on('uncaughtException',  e => console.error('❌ Exception:', e?.message));

(async () => { await loginAll(); await mainLoop(); })();
