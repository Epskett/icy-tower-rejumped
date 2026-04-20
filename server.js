const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const {
    supabase,
    getProfile, updateProfile, addCoins, recordScore, getLeaderboard,
    getChallenges, createChallenge, updateChallenge, deleteChallenge
} = require('./backend/db');
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

    return `
    <response status="ok" free_towers="0">
        <user uid="${save.ng_id}" first_name="${save.first_name || 'Player'}" last_name="${save.last_name || ''}" gender="${save.gender}" profile_pic="${proxiedPic}" language="${save.language}" last_active="${Math.floor(new Date(save.last_active).getTime() / 1000)}" last_version="${save.last_version}" />
        <progress>
            <coins>${save.coins}</coins>
            <vip_level>${save.vip_level}</vip_level>
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
            <vip_level>${save.vip_level}</vip_level>
        </progress>
        <trophies>${save.trophies || ''}</trophies>
        <results>
            ${resultsXML}
        </results>
    </response>`;
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/language/:file', (req, res) => {
    const file = req.params.file;
    if (!file.endsWith('.xml') || file.includes('..') || file.includes('/')) {
        return res.status(400).send('Invalid file');
    }
    const langPath = path.join(__dirname, 'icytower', 'flash', 'data', 'language', file);
    if (!fs.existsSync(langPath)) {
        return res.status(404).send('Language file not found');
    }
    res.set('Content-Type', 'text/xml; charset=utf-8');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(langPath);
});


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
            if (params.trophies !== undefined) updates.trophies = params.trophies;
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
