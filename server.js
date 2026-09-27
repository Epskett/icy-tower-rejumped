const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const db = require('./backend/db');
const {
    supabase,
    getProfile, updateProfile, addCoins, recordScore, getLeaderboard,
    getChallenges, createChallenge, updateChallenge, deleteChallenge
} = db;

const replayChars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function generateReplayCode(len = 5) {
    let code = '';
    for (let i = 0; i < len; i++) {
        code += replayChars.charAt(Math.floor(Math.random() * replayChars.length));
    }
    return code;
}

const memoryReplays = new Map();

const safeSaveReplay = async function (replayData) {
    if (typeof db.saveReplay === 'function') {
        try {
            return await db.saveReplay(replayData);
        } catch (dbErr) {
            console.error('[saveReplay] db.saveReplay threw:', dbErr.message);
        }
    }

    const ngId = String(replayData.ng_id || 'guest');
    const client = db.supabase || supabase;
    let code = generateReplayCode(5);

    if (client) {
        try {
            if (ngId !== 'guest') {
                const { data: existing } = await client
                    .from('replays')
                    .select('id, created_at, is_hall_of_fame')
                    .eq('ng_id', ngId)
                    .order('created_at', { ascending: true });

                if (existing && existing.length >= 5) {
                    const toDelete = existing.find(r => !r.is_hall_of_fame);
                    if (toDelete) {
                        await client.from('replays').delete().eq('id', toDelete.id);
                    }
                }
            }

            let attempts = 0;
            while (attempts < 5) {
                const { data: existingCode } = await client
                    .from('replays')
                    .select('id')
                    .eq('id', code)
                    .maybeSingle();
                if (!existingCode) break;
                code = generateReplayCode(5);
                attempts++;
            }

            const record = {
                id: code,
                ng_id: ngId,
                player_name: String(replayData.player_name || 'Player').slice(0, 32),
                player_sex: String(replayData.player_sex || 'MALE').slice(0, 10),
                player_appearance: String(replayData.player_appearance || ''),
                tid: parseInt(replayData.tid) || 1,
                seed: parseInt(replayData.seed) || 0,
                score: parseInt(replayData.score) || 0,
                floor: parseInt(replayData.floor) || 0,
                combo: parseInt(replayData.combo) || 0,
                replay_data: String(replayData.replay_data || ''),
                is_hall_of_fame: !!replayData.is_hall_of_fame
            };

            const { data, error } = await client
                .from('replays')
                .insert([record])
                .select()
                .single();

            if (!error && data) {
                memoryReplays.set(code, data);
                return data;
            }
            if (error) {
                console.error('[saveReplay] Supabase insert error:', error.message || error);
            }
        } catch (supabaseEx) {
            console.error('[saveReplay] Supabase exception:', supabaseEx.message);
        }
    }

    // In-memory fallback
    const fallback = {
        id: code,
        ng_id: ngId,
        player_name: String(replayData.player_name || 'Player').slice(0, 32),
        player_sex: String(replayData.player_sex || 'MALE').slice(0, 10),
        player_appearance: String(replayData.player_appearance || ''),
        tid: parseInt(replayData.tid) || 1,
        seed: parseInt(replayData.seed) || 0,
        score: parseInt(replayData.score) || 0,
        floor: parseInt(replayData.floor) || 0,
        combo: parseInt(replayData.combo) || 0,
        replay_data: String(replayData.replay_data || ''),
        is_hall_of_fame: false,
        created_at: new Date().toISOString()
    };
    memoryReplays.set(code, fallback);
    return fallback;
};

const safeGetReplay = async function (code) {
    const cleanCode = String(code || '').trim().replace(/^#/, '').toUpperCase();
    if (typeof db.getReplay === 'function') {
        try {
            const r = await db.getReplay(cleanCode);
            if (r) return r;
        } catch (e) {}
    }

    const client = db.supabase || supabase;
    if (client) {
        try {
            const { data, error } = await client
                .from('replays')
                .select('*')
                .eq('id', cleanCode)
                .single();
            if (!error && data) return data;
        } catch (err) {}
    }

    return memoryReplays.get(cleanCode) || null;
};

const safeGetUserReplays = async function (ngId, limit = 5) {
    if (typeof db.getUserReplays === 'function') {
        try {
            const r = await db.getUserReplays(ngId, limit);
            if (r && r.length > 0) return r;
        } catch (e) {}
    }

    const client = db.supabase || supabase;
    if (client) {
        try {
            const { data, error } = await client
                .from('replays')
                .select('id, score, floor, combo, tid, created_at, player_name')
                .eq('ng_id', String(ngId))
                .order('created_at', { ascending: false })
                .limit(limit);
            if (!error && data) return data;
        } catch (err) {}
    }

    return Array.from(memoryReplays.values())
        .filter(r => r.ng_id === String(ngId))
        .slice(-limit);
};
const sharp = require('sharp');
const fs = require('fs');
const https = require('https');
const http = require('http');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

const avatarsDir = path.join(__dirname, 'avatars');
if (!fs.existsSync(avatarsDir)) {
    fs.mkdirSync(avatarsDir, { recursive: true });
}

app.use(cors());
app.use(compression());
app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));
app.use(bodyParser.json({ limit: '5mb' }));

const apiNoCache = (req, res, next) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
};

app.use('/games/icytower/backend', apiNoCache);
app.use('/api', apiNoCache);
app.use('/tools', apiNoCache);

app.post('/api/debug_log', (req, res) => {
    let b = req.body;
    if (Buffer.isBuffer(b)) {
        try { b = JSON.parse(b.toString('utf8')); } catch (e) { b = b.toString('utf8'); }
    }
    console.log('[DEBUG_LOG]:', b);
    res.json({ ok: true });
});


function decodeBody(body) {
    if (body && body.data) {
        const colonIdx = body.data.indexOf(':');
        const b64 = colonIdx !== -1 ? body.data.substring(colonIdx + 1) : body.data;
        try {
            const raw = Buffer.from(b64, 'base64').toString('utf8');
            const params = new URLSearchParams(raw);
            const result = {};
            for (const [k, v] of params) result[k] = v;
            return result;
        } catch (e) {
            console.error('[decodeBody] Failed to decode:', e.message);
        }
    }
    return body;
}

let baseUrl = process.env.BACKEND_URL || "https://icy-tower-rejumped.onrender.com";
if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

const ALL_TROPHY_IDS = [
    "bigspender", "challenger", "coins", "combo", "floors1", "combo2", "floors2",
    "classic", "disco", "jungle", "western", "space", "factory", "ocean", "adventure",
    "friends", "gift", "hello", "nocoins", "addict", "cheapy"
];

function calculateTrophyTier(trophiesString) {
    if (!trophiesString) return 0;
    const map = {};
    for (const entry of trophiesString.split('|')) {
        const parts = entry.split(',');
        if (parts.length >= 2) {
            const id = parts[0].trim();
            const level = parseInt(parts[1]) || 0;
            if (id) map[id] = level;
        }
    }
    const levels = ALL_TROPHY_IDS.map(id => map[id] || 0);
    if (levels.every(lvl => lvl >= 300)) return 3; // Gold (Frame 4)
    if (levels.every(lvl => lvl >= 200)) return 2; // Silver (Frame 3)
    if (levels.every(lvl => lvl >= 100)) return 1; // Bronze (Frame 2)
    return 0; // Default (Frame 1)
}

function buildAccountXML(save) {
    const itemsXML = save.items.map(id => `<item id="${id}" />`).join('\n            ');
    const towersXML = save.towers.map(tid => `<tower tid="${tid}" />`).join('\n            ');

    let resultsXML = "";
    if (save.tower_results) {
        for (const tid in save.tower_results) {
            const r = save.tower_results[tid];
            resultsXML += `<result uid="${save.ng_id}" tid="${tid}" when="all_time" score="${r.score}" floor="${r.floor}" combo="${r.combo}" />\n            `;
        }
    }

    const witems = Buffer.from('<witems></witems>').toString('base64');
    const proxiedPic = `${baseUrl}/avatars/${save.ng_id}.png`;
    const computedVipLevel = calculateTrophyTier(save.trophies);

    return `
    <response status="ok" free_towers="0">
        <user uid="${save.ng_id}" first_name="${save.first_name || 'Player'}" last_name="${save.last_name || ''}" gender="${save.gender}" profile_pic="${proxiedPic}" language="${save.language}" last_active="${Math.floor(new Date(save.last_active).getTime() / 1000)}" last_version="${save.last_version}" />
        <progress>
            <coins>${save.coins}</coins>
            <vip_level>${computedVipLevel}</vip_level>
            <new_coins>0</new_coins>
            <times_played>${save.stats.times_played}</times_played>
            <scores>${save.stats.scores}</scores>
            <floors>${save.stats.floors}</floors>
            <combos>${save.stats.combos}</combos>
            <jumps>${save.stats.jumps}</jumps>
            <challenges_won>${save.stats.challenges_won}</challenges_won>
            <challenges_lost>${save.stats.challenges_lost}</challenges_lost>
        </progress>
        <appearance>${save.appearance}</appearance>
        <trophies>${save.trophies}</trophies>
        <items>
            ${itemsXML}
        </items>
        <towers>
            ${towersXML}
        </towers>
        <results>
            ${resultsXML}
        </results>
        <news><item title="Welcome Back!" date="2026-04-12" text="Icy Tower Rejumped is live on Newgrounds!" /></news>
        <witems>${witems}</witems>
        <daily>
            <item id="1" coins="100" />
        </daily>
    </response>`;
}

const wrapXML = (content) => `<?xml version="1.0" encoding="UTF-8"?>\n${content}`;

function buildUserProgressXML(save) {
    let resultsXML = '';
    if (save.tower_results) {
        for (const tid in save.tower_results) {
            const r = save.tower_results[tid];
            resultsXML += `<result uid="${save.ng_id}" tid="${tid}" when="all_time" score="${r.score}" floor="${r.floor}" combo="${r.combo}" />\n            `;
        }
    }
    const computedVipLevel = calculateTrophyTier(save.trophies);
    return `
    <response status="ok">
        <result>1</result>
        <progress uid="${save.ng_id}">
            <times_played>${save.stats.times_played}</times_played>
            <scores>${save.stats.scores}</scores>
            <floors>${save.stats.floors}</floors>
            <combos>${save.stats.combos}</combos>
            <jumps>${save.stats.jumps}</jumps>
            <challenges_won>${save.stats.challenges_won}</challenges_won>
            <challenges_lost>${save.stats.challenges_lost}</challenges_lost>
            <coins>${save.coins}</coins>
            <vip_level>${computedVipLevel}</vip_level>
        </progress>
        <trophies>${save.trophies || ''}</trophies>
        <results>
            ${resultsXML}
        </results>
    </response>`;
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/img-proxy', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('CORS Proxy: Missing URL');

    if (targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1')) {
        try {
            const urlObj = new URL(targetUrl);
            const localPath = path.join(__dirname, urlObj.pathname.replace(/^\/+/g, ''));
            if (fs.existsSync(localPath) && !localPath.includes('img-proxy')) {
                console.log('[img-proxy] Serving local asset:', localPath);
                return res.sendFile(localPath);
            }
        } catch (err) {
            console.error('[img-proxy] Local path resolution failed:', err.message);
        }
    }

    console.log('[img-proxy] Fetching & Converting:', targetUrl);

    try {
        const response = await fetch(targetUrl);
        if (!response.ok) throw new Error(`Remote server responded with ${response.status}`);

        const buffer = await response.arrayBuffer();

        const pngBuffer = await sharp(Buffer.from(buffer))
            .png()
            .toBuffer();

        res.set('Content-Type', 'image/png');
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(pngBuffer);
    } catch (e) {
        console.error('[img-proxy] Sharp/Proxy Error:', e.message);
        res.status(500).send('Proxy error');
    }
});

app.get('/tools/check_interstitial', (req, res) => {
    res.send('interstitial=0');
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

const staticOptions = {
    maxAge: '1y',
    etag: true
};

app.use(express.static(path.join(__dirname, 'icytower/flash'), staticOptions));
app.use(express.static(__dirname, staticOptions));
app.use('/avatars', express.static(path.join(__dirname, 'avatars'), staticOptions));

async function ensureAvatarCached(uid, avatarUrl) {
    if (!avatarUrl) return;
    const localPath = path.join(avatarsDir, `${uid}.png`);
    if (fs.existsSync(localPath)) return;

    try {
        console.log(`[sync-profile] Auto-caching avatar for UID: ${uid}`);
        const response = await fetch(avatarUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        await sharp(Buffer.from(buffer))
            .resize(100, 100)
            .png()
            .toFile(localPath);
    } catch (e) {
        console.error(`[sync-profile] Failed to cache avatar for ${uid}:`, e.message);
    }
}

app.post('/games/icytower/backend/server.1.0.1/accounts.php', async (req, res) => {
    const params = decodeBody(req.body);
    const ngId = params.accountUID || params.uid || "420";
    console.log('[accounts.php]', params.do || 'load', 'UID:', ngId);

    try {
        const save = await getProfile(ngId);
        await updateProfile(ngId, { last_active: new Date().toISOString() });

        res.set('Content-Type', 'text/xml');
        res.send(wrapXML(buildAccountXML(save)));
    } catch (e) {
        console.error(e);
        res.status(500).send('Database Error');
    }
});

app.post('/api/save_replay', express.json(), async (req, res) => {
    try {
        const replay = await safeSaveReplay(req.body);
        res.json({ ok: true, replay });
    } catch (e) {
        console.error('[save_replay] Error:', e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/replay/:code', async (req, res) => {
    try {
        const replay = await safeGetReplay(req.params.code);
        if (!replay) {
            return res.status(404).json({ ok: false, error: 'Replay not found' });
        }
        res.json({ ok: true, replay });
    } catch (e) {
        console.error('[get_replay] Error:', e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/user_replays/:ngId', async (req, res) => {
    try {
        const replays = await safeGetUserReplays(req.params.ngId);
        res.json({ ok: true, replays });
    } catch (e) {
        console.error('[user_replays] Error:', e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/sync-profile', express.json(), async (req, res) => {
    const { uid, name, avatar } = req.body;
    console.log('[sync-profile] Syncing UID:', uid, 'Name:', name);

    try {
        await getProfile(uid);

        await updateProfile(uid, {
            first_name: name,
            profile_pic: avatar
        });
        const avatarUrl = avatar;
        const localAvatarPath = path.join(avatarsDir, `${uid}.png`);

        if (!fs.existsSync(localAvatarPath)) {
            console.log(`[sync-profile] Downloading avatar for ${name}...`);

            const client = avatarUrl.startsWith('https') ? https : http;

            client.get(avatarUrl, (response) => {
                if (response.statusCode === 200) {
                    const transformer = sharp().png().resize(100, 100);
                    response.pipe(transformer).toFile(localAvatarPath, (err) => {
                        if (err) console.error('[sync-profile] Avatar conversion failed:', err.message);
                        else console.log(`[sync-profile] Avatar cached: ${localAvatarPath}`);
                    });
                } else {
                    console.error(`[sync-profile] Failed to download avatar: Status ${response.statusCode}`);
                }
            }).on('error', (err) => {
                console.error('[sync-profile] Download error:', err.message);
            });
        } else {
            console.log(`[sync-profile] Avatar already cached for ${name}. Skipping download.`);
        }

        res.json({ success: true });
    } catch (e) {
        console.error('[sync-profile] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/friends-profiles', express.json(), async (req, res) => {
    const { uids } = req.body;
    console.log('[friends-profiles] Fetching profiles for UIDs:', uids);
    if (!uids || !Array.isArray(uids) || uids.length === 0) {
        return res.json({});
    }

    try {
        const cleanUids = uids.map(id => id.toString().trim()).filter(id => id.length > 0);
        const { data, error } = await supabase
            .from('profiles')
            .select('ng_id, appearance, gender')
            .in('ng_id', cleanUids);

        if (error) {
            console.error('[friends-profiles] Error:', error);
            return res.status(500).json({ error: error.message });
        }

        const result = {};
        if (data) {
            data.forEach(p => {
                result[p.ng_id] = {
                    appearance: p.appearance || "",
                    gender: p.gender || (p.appearance && p.appearance.startsWith("FEMALE,") ? "FEMALE" : "MALE")
                };
            });
        }
        res.json(result);
    } catch (e) {
        console.error('[friends-profiles] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/games/icytower/backend/server.1.0.1/server3.php', async (req, res) => {
    const params = decodeBody(req.body);
    const ngId = params.uid || "420";
    const action = params.do;
    console.log('[server3.php]', action, 'UID:', ngId);

    try {
        const save = await getProfile(ngId);
        const updates = {};

        if (action === 'putAppearance') {
            if (params.appearance) {
                updates.appearance = params.appearance;
                console.log('  → Saved appearance:', params.appearance);
            }
        } else if (action === 'putTrophies') {
            if (params.trophies !== undefined) {
                updates.trophies = params.trophies;
                updates.vip_level = calculateTrophyTier(params.trophies);
            }
            const bonus = parseInt(params.coins) || 0;
            if (bonus > 0) {
                await addCoins(ngId, bonus);
                console.log(`  → Trophy bonus: +${bonus} coins (Atomic)`);
            }
        } else if (action === 'putLanguage') {
            if (params.language) updates.language = params.language;
            if (params.appearance) updates.appearance = params.appearance;
            console.log('  → Saved language:', updates.language);
        }

        if (Object.keys(updates).length > 0) {
            await updateProfile(ngId, updates);
        }

        res.set('Content-Type', 'text/xml');
        res.send(wrapXML('<response status="ok"><result>1</result></response>'));
    } catch (e) {
        console.error(e);
        res.status(500).send('Database Error');
    }
});

app.post('/games/icytower/backend/server.1.0.1/transactions.php', async (req, res) => {
    const params = decodeBody(req.body);
    const ngId = params.uid || "420";
    const action = params.do;
    console.log('[transactions.php]', action, 'UID:', ngId);

    try {
        const save = await getProfile(ngId);
        let okToBuy = false;
        const updates = {};

        if (action === 'purchaseItem') {
            const itemId = params.item;
            const cost = parseInt(params.cost) || 0;
            if (save.items.includes(itemId)) {
                okToBuy = true;
            } else if (parseInt(save.coins) >= cost) {
                updates.coins = parseInt(save.coins) - cost;
                updates.items = [...save.items, itemId];
                okToBuy = true;
                console.log(`  → Bought item "${itemId}" for ${cost} coins`);
            }
        } else if (action === 'purchaseTower') {
            const tid = parseInt(params.tid);
            const cost = parseInt(params.cost) || 0;
            if (save.towers.includes(tid)) {
                okToBuy = true;
            } else if (parseInt(save.coins) >= cost) {
                updates.coins = parseInt(save.coins) - cost;
                updates.towers = [...save.towers, tid];
                okToBuy = true;
                console.log(`  → Bought tower TID ${tid} for ${cost} coins`);
            }
        }

        if (okToBuy && Object.keys(updates).length > 0) {
            await updateProfile(ngId, updates);
        }

        res.set('Content-Type', 'text/xml');
        res.send(wrapXML(`<response status="ok"><result>${okToBuy ? 1 : 0}</result></response>`));
    } catch (e) {
        console.error(e);
        res.status(500).send('Database Error');
    }
});

app.post('/games/icytower/backend/server.1.0.1/get_user_progress.php', async (req, res) => {
    const params = decodeBody(req.body);
    const targetId = params.accountUID || params.uid || '420';
    console.log('[get_user_progress.php] Fetching progress for UID:', targetId);

    try {
        const save = await getProfile(targetId);
        res.set('Content-Type', 'text/xml');
        res.send(wrapXML(buildUserProgressXML(save)));
    } catch (e) {
        console.error('[get_user_progress.php] Error:', e);
        res.status(500).send('Database Error');
    }
});

app.post('/games/icytower/backend/server.1.0.1/challenges.php', async (req, res) => {
    const params = decodeBody(req.body);
    const action = params.do;
    const ngId = params.uid || "0";

    console.log('[challenges.php]', { action, uid: ngId });

    try {
        if (action === 'getChallenges') {
            const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            await supabase.from('challenges').delete()
                .or(`uid1.eq.${ngId},uid2.eq.${ngId}`)
                .eq('turn', 0);
            await supabase.from('challenges').delete()
                .or(`uid1.eq.${ngId},uid2.eq.${ngId}`)
                .lt('created_at', cutoff);

            const list = await getChallenges(ngId);

            let challengesXML = "";
            list.forEach(c => {
                challengesXML += `
        <challenge 
            id="${c.id}" 
            uid1="${c.uid1}" 
            uid2="${c.uid2}" 
            tid="${c.tid}" 
            category="${c.category}" 
            seed="${c.seed}" 
            turn="${c.turn}" 
            phase="${c.phase}" 
            replay1="${c.replay1 || ''}" 
            replay2="${c.replay2 || ''}" 
            floor1="${c.floor1 || 0}" 
            floor2="${c.floor2 || 0}" 
            comment1="${c.comment1 || ''}" 
            comment2="${c.comment2 || ''}" 
        />`;
            });

            res.set('Content-Type', 'text/xml');
            res.send(wrapXML(`<response status="ok">
    <challenges>
        ${challengesXML}
    </challenges>
</response>`));

        } else if (action === 'putChallenge') {
            const data = {
                uid1: ngId,
                uid2: params.uid2,
                tid: parseInt(params.tid),
                category: params.category,
                seed: parseInt(params.seed),
                phase: parseInt(params.phase) || 0,
                replay1: params.replay,
                floor1: parseInt(params.floor) || 0,
                turn: 2
            };
            const newC = await createChallenge(data);
            res.set('Content-Type', 'text/xml');
            res.send(wrapXML(`<response status="ok"><challenge id="${newC.id}" /></response>`));

        } else if (action === 'startChallenge') {
            const id = params.id;
            await updateChallenge(id, { status: 'in_progress' });
            res.set('Content-Type', 'text/xml');
            res.send(wrapXML('<response status="ok" />'));

        } else if (action === 'updateChallenge') {
            const id = params.id;
            const isDraw = params.draw === 'true';
            const winnerUID = params.winner;
            const loserUID = params.loser;

            const updates = {
                replay2: params.replay,
                floor2: parseInt(params.floor) || 0,
                winner: winnerUID,
                status: 'completed',
                turn: 1,
                phase: 2
            };
            await updateChallenge(id, updates);

            if (!isDraw && winnerUID && loserUID && winnerUID !== loserUID) {
                const [winSave, loseSave] = await Promise.all([
                    getProfile(winnerUID),
                    getProfile(loserUID)
                ]);
                await Promise.all([
                    updateProfile(winnerUID, {
                        stats: { ...winSave.stats, challenges_won: (winSave.stats.challenges_won || 0) + 1 }
                    }),
                    updateProfile(loserUID, {
                        stats: { ...loseSave.stats, challenges_lost: (loseSave.stats.challenges_lost || 0) + 1 }
                    })
                ]);
                console.log(`[challenges.php] updateChallenge: winner=${winnerUID} (+1 won), loser=${loserUID} (+1 lost)`);
            } else if (isDraw) {
                console.log(`[challenges.php] updateChallenge: draw - no stat change`);
            }

            res.set('Content-Type', 'text/xml');
            res.send(wrapXML('<response status="ok" />'));

        } else if (action === 'deleteChallenge') {
            const id = params.id;
            await deleteChallenge(id);
            res.set('Content-Type', 'text/xml');
            res.send(wrapXML('<response status="ok" />'));
        }

    } catch (e) {
        console.error('[challenges.php] Error:', e);
        res.status(500).send('Challenge Error');
    }
});

app.post('/games/icytower/backend/server.1.0.1/get_results.php', async (req, res) => {
    const params = decodeBody(req.body);
    const tid = parseInt(params.tid) || 1;
    const orderMetric = params.order || 'score';
    const when = params.when || 'all_time';
    const limit = parseInt(params.amount) || 25;
    const uids = (params.uids && params.uids.length > 0) ? params.uids.split(',') : null;

    console.log('[get_results.php]', { tid, orderMetric, when, social: !!uids });

    try {
        const scores = await getLeaderboard(tid, orderMetric, when, uids, limit);

        let resultsXML = "";
        scores.forEach(s => {
            if (s.profile_pic) {
                ensureAvatarCached(s.ng_id, s.profile_pic);
            }

            const localAvatar = `${baseUrl}/avatars/${s.ng_id}.png`;

            resultsXML += `<user uid="${s.ng_id}" first_name="${s.first_name}" profile_pic="${localAvatar}" />\n        `;
            resultsXML += `<result uid="${s.ng_id}" tid="${s.tid}" when="${when}" score="${s.score}" floor="${s.floor}" combo="${s.combo}" />\n        `;
        });

        res.set('Content-Type', 'text/xml');
        res.send(wrapXML(`<response status="ok">\n        ${resultsXML}</response>`));
    } catch (e) {
        console.error('[get_results.php] Error:', e);
        res.status(500).send('Database Error');
    }
});

app.post('/games/icytower/backend/server.1.0.1/put_results.php', async (req, res) => {
    const params = decodeBody(req.body);
    const ngId = params.uid || "420";
    console.log('[put_results.php]', 'UID:', ngId);

    try {
        const save = await getProfile(ngId);
        const updates = {
            stats: { ...save.stats },
            tower_results: { ...save.tower_results }
        };

        const earned = parseInt(params.coinstaken) || parseInt(params.coins) || 0;
        if (earned > 0) {
            await addCoins(ngId, earned);
            console.log(`  → Round earned: +${earned} coins (Atomic)`);
        }

        updates.stats.times_played++;
        updates.stats.scores += (parseInt(params.score) || 0);
        updates.stats.floors += (parseInt(params.floor) || 0);
        updates.stats.combos += (parseInt(params.combos) || 0);
        updates.stats.jumps += (parseInt(params.jumps) || 0);

        const tid = params.tid || "1";
        if (!updates.tower_results[tid]) {
            updates.tower_results[tid] = { score: 0, floor: 0, combo: 0 };
        }

        const runScore = parseInt(params.score) || 0;
        const runFloor = parseInt(params.floor) || 0;
        const runCombo = parseInt(params.combo) || 0;

        if (runScore > updates.tower_results[tid].score) updates.tower_results[tid].score = runScore;
        if (runFloor > updates.tower_results[tid].floor) updates.tower_results[tid].floor = runFloor;
        if (runCombo > updates.tower_results[tid].combo) updates.tower_results[tid].combo = runCombo;

        await updateProfile(ngId, updates);

        await recordScore(ngId, tid, { score: runScore, floor: runFloor, combo: runCombo });

        res.set('Content-Type', 'text/xml');
        res.send(wrapXML('<response status="ok" />'));
    } catch (e) {
        console.error(e);
        res.status(500).send('Database Error');
    }
});

app.get('/profile.png', (req, res) => {
    const profPath = path.join(__dirname, 'profile.png');
    if (fs.existsSync(profPath)) {
        res.sendFile(profPath);
    } else {
        res.status(404).send('Not found');
    }
});

app.use('/ImageCardAssets', express.static(path.join(__dirname, 'ImageCardAssets')));

app.use('/games/icytower', (req, res) => {
    const fullPath = path.join(__dirname, 'icytower/flash', req.path);
    if (fs.existsSync(fullPath)) {
        res.sendFile(fullPath);
    } else {
        console.warn('[404] Missing asset:', fullPath);
        res.status(404).send('Not found');
    }
});

app.listen(PORT, () => {
    console.log(`Icy Tower Rejumped Proxy running at http://localhost:${PORT}`);
});
