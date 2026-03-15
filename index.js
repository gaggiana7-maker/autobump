'use strict';

// ============================================================
//  DISBOARD AUTO BUMPER
//  - Slash command reale (non testo)
//  - Delay random 1-10 min dopo le 2 ore
//  - Retry automatico su errori (max 5 tentativi)
//  - Reconnect automatico se va offline
//  - Log dettagliato di tutto
//  - Gestione cooldown Disboard
//  - Gestione errori completa
// ============================================================

const { Client } = require('discord.js-selfbot-v13');

// ─── CONFIG ────────────────────────────────────────────────
const TOKEN       = process.env.TOKEN;
const CHANNEL_ID  = process.env.CHANNEL_ID;
const DISBOARD_ID = '302050872383242240';

const BUMP_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 ore
const DELAY_MIN_MS     = 1 * 60 * 1000;       // 1 minuto minimo
const DELAY_MAX_MS     = 10 * 60 * 1000;      // 10 minuti massimo
const MAX_RETRIES      = 5;
const RETRY_DELAY_MS   = 30 * 1000;           // 30s tra retry
// ───────────────────────────────────────────────────────────

// ─── UTILITIES ─────────────────────────────────────────────
function log(level, msg) {
    const time = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
    const icons = {
        INFO:  '📋',
        OK:    '✅',
        WARN:  '⚠️ ',
        ERROR: '❌',
        WAIT:  '⏳',
        BUMP:  '🚀',
    };
    console.log(`[${time}] ${icons[level] || '•'} [${level}] ${msg}`);
}

function randomDelay() {
    return Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1)) + DELAY_MIN_MS;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours   = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
}
// ───────────────────────────────────────────────────────────

// ─── VALIDAZIONE VARIABILI ──────────────────────────────────
if (!TOKEN) {
    log('ERROR', "TOKEN mancante! Aggiungilo nelle variabili d'ambiente Railway.");
    process.exit(1);
}
if (!CHANNEL_ID) {
    log('ERROR', "CHANNEL_ID mancante! Aggiungilo nelle variabili d'ambiente Railway.");
    process.exit(1);
}
// ───────────────────────────────────────────────────────────

// ─── CLIENT SETUP ──────────────────────────────────────────
const client = new Client({ checkUpdate: false });
// ───────────────────────────────────────────────────────────

// ─── STATO GLOBALE ─────────────────────────────────────────
let bumpCount    = 0;
let failCount    = 0;
let lastBumpTime = null;
let isRunning    = false;
// ───────────────────────────────────────────────────────────

// ─── FUNZIONE BUMP ──────────────────────────────────────────
async function doBump() {
    // Prova a prendere il canale dalla cache
    let channel = client.channels.cache.get(CHANNEL_ID);

    // Se non è in cache, prova a fetcharlo
    if (!channel) {
        log('WARN', `Canale non in cache, tento fetch...`);
        try {
            channel = await client.channels.fetch(CHANNEL_ID);
        } catch (e) {
            log('ERROR', `Impossibile fetchare il canale: ${e.message}`);
            return { success: false, fatal: false };
        }
    }

    if (!channel) {
        log('ERROR', 'Canale ancora null dopo fetch. Controlla CHANNEL_ID.');
        return { success: false, fatal: true };
    }

    const guild = channel.guild;
    if (!guild) {
        log('ERROR', 'Guild non trovata per questo canale.');
        return { success: false, fatal: true };
    }

    log('BUMP', `Eseguo /bump nel canale #${channel.name} — server: ${guild.name}`);

    try {
        await channel.sendSlash(DISBOARD_ID, 'bump');
        bumpCount++;
        lastBumpTime = new Date();
        log('OK', `Bump #${bumpCount} eseguito con successo! (${lastBumpTime.toLocaleString('it-IT')})`);
        return { success: true, fatal: false };

    } catch (err) {
        const msg = err.message || '';
        log('ERROR', `Errore sendSlash: ${msg}`);

        // Cooldown Disboard attivo
        if (msg.includes('cooldown') || msg.includes('wait') || msg.includes('You need to wait')) {
            log('WARN', 'Disboard in cooldown — aspetto 5 minuti e riprovo...');
            await sleep(5 * 60 * 1000);
            return { success: false, fatal: false };
        }

        // Permessi mancanti
        if (msg.includes('Missing Permissions') || msg.includes('permission')) {
            log('ERROR', 'Permessi mancanti! Controlla che l\'account possa usare slash nel canale.');
            return { success: false, fatal: true };
        }

        // Canale non trovato
        if (msg.includes('Unknown Channel')) {
            log('ERROR', 'Canale non trovato da Discord. Controlla CHANNEL_ID.');
            return { success: false, fatal: true };
        }

        // Bot Disboard non presente
        if (msg.includes('Unknown Application') || msg.includes('Unknown Interaction')) {
            log('ERROR', 'Disboard non trovato nel server. È presente nel server?');
            return { success: false, fatal: true };
        }

        // Token non valido
        if (msg.includes('401') || msg.includes('Invalid token') || msg.includes('Unauthorized')) {
            log('ERROR', 'Token non valido o scaduto! Aggiorna TOKEN nelle variabili.');
            return { success: false, fatal: true };
        }

        // Errore generico non fatale
        return { success: false, fatal: false };
    }
}
// ───────────────────────────────────────────────────────────

// ─── LOOP PRINCIPALE ────────────────────────────────────────
async function bumpLoop() {
    if (isRunning) return;
    isRunning = true;

    log('INFO', '═══════════════════════════════════════');
    log('INFO', '       DISBOARD AUTO BUMPER AVVIATO    ');
    log('INFO', `  Canale ID : ${CHANNEL_ID}`);
    log('INFO', `  Intervallo: 2 ore + random 1-10 min  `);
    log('INFO', '═══════════════════════════════════════');

    // Piccolo delay iniziale per stabilizzare la connessione
    log('WAIT', 'Attendo 5 secondi prima del primo bump...');
    await sleep(5000);

    while (true) {
        let success = false;
        let attempts = 0;
        let fatal = false;

        // ── Retry loop ──────────────────────────────────────
        while (!success && !fatal && attempts < MAX_RETRIES) {
            attempts++;

            if (attempts > 1) {
                log('WARN', `Tentativo ${attempts}/${MAX_RETRIES} tra ${RETRY_DELAY_MS / 1000}s...`);
                await sleep(RETRY_DELAY_MS);
            }

            const result = await doBump();
            success = result.success;
            fatal   = result.fatal;
        }
        // ────────────────────────────────────────────────────

        if (!success) {
            failCount++;
            if (fatal) {
                log('ERROR', `Errore fatale! Controlla la configurazione. Il bot si ferma.`);
                process.exit(1);
            }
            log('ERROR', `Bump fallito dopo ${MAX_RETRIES} tentativi. Totale fallimenti: ${failCount}`);
        }

        // ── Calcolo prossimo bump ────────────────────────────
        const extra   = randomDelay();
        const total   = BUMP_INTERVAL_MS + extra;
        const nextStr = new Date(Date.now() + total).toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

        log('WAIT', `Prossimo bump tra ${formatTime(total)} (alle ${nextStr})`);
        log('INFO', `Stats: ✅ Bump riusciti: ${bumpCount} | ❌ Falliti: ${failCount}`);
        log('INFO', '───────────────────────────────────────');

        await sleep(total);
    }
}
// ───────────────────────────────────────────────────────────

// ─── EVENTI CLIENT ──────────────────────────────────────────
client.on('ready', async () => {
    log('OK', `Connesso come ${client.user.tag} (${client.user.id})`);
    bumpLoop();
});

client.on('disconnect', () => {
    log('WARN', 'Client disconnesso da Discord.');
    isRunning = false;
});

client.on('error', (err) => {
    log('ERROR', `Errore client: ${err.message}`);
});

client.on('warn', (msg) => {
    log('WARN', `Warning client: ${msg}`);
});

// Gestione crash inaspettati
process.on('unhandledRejection', (err) => {
    log('ERROR', `Unhandled rejection: ${err?.message || err}`);
});

process.on('uncaughtException', (err) => {
    log('ERROR', `Uncaught exception: ${err?.message || err}`);
});
// ───────────────────────────────────────────────────────────

// ─── LOGIN ──────────────────────────────────────────────────
log('INFO', 'Connessione a Discord...');
client.login(TOKEN).catch(err => {
    log('ERROR', `Login fallito: ${err.message}`);
    log('ERROR', 'Controlla che il TOKEN sia corretto.');
    process.exit(1);
});
// ───────────────────────────────────────────────────────────
