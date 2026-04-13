require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase credentials in .env file');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const DEFAULT_SAVE = {
    gender: "MALE",
    profile_pic: "https://icy-tower-rejumped.onrender.com/profile.png",
    language: "english",
    coins: 50000,
    vip_level: 0,
    appearance: "MALE,mouthGlad|hairBoyFringe|shirtBlackVest|haircolorRed|skinYellow|noseNostrils|trouserBlueJeans",
    trophies: "",
    items: [
        "mouthGlad",
        "hairBoyFringe",
        "shirtBlackVest",
        "haircolorRed",
        "skinYellow",
        "noseNostrils",
        "trouserBlueJeans",
        "standard_body"
    ],
    towers: [1],
    stats: {
        times_played: 0,
        scores: 0,
        floors: 0,
        combos: 0,
        jumps: 0,
        challenges_won: 0,
        challenges_lost: 0
    },
    tower_results: {
        "1": { score: 0, floor: 0, combo: 0 }
    },
    last_version: "1.0.2"
};

async function getProfile(ngId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('ng_id', ngId)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('[DB] Error fetching profile:', error);
        throw error;
    }

    if (data) {
        return data;
    }

    const { data: newProfile, error: createError } = await supabase
        .from('profiles')
        .insert([{
            ng_id: ngId,
            ...DEFAULT_SAVE
        }])
        .select()
        .single();

    if (createError) {
        console.error('[DB] Error creating profile:', createError);
        throw createError;
    }

    return newProfile;
}

async function getProfiles(ngIds) {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('ng_id', ngIds);

    if (error) {
        console.error('[DB] Error fetching profiles:', error);
        throw error;
    }

    return data;
}

async function updateProfile(ngId, updates) {
    const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('ng_id', ngId)
        .select()
        .single();

    if (error) {
        console.error('[DB] Error updating profile:', error);
        throw error;
    }

    return data;
}

async function recordScore(ngId, tid, stats) {
    const { error } = await supabase
        .from('leaderboard')
        .insert([{
            ng_id: String(ngId),
            tid: parseInt(tid),
            score: parseInt(stats.score) || 0,
            floor: parseInt(stats.floor) || 0,
            combo: parseInt(stats.combo) || 0
        }]);

    if (error) {
        console.error('[DB] Error recording score:', error);
        throw error;
    }
}

async function getLeaderboard(tid, orderMetric, when, uids = null, limit = 25) {
    let startDate = '1970-01-01';
    let endDate = '9999-12-31';

    if (when === 'this_week') {
        const start = new Date();
        start.setUTCDate(start.getUTCDate() - start.getUTCDay());
        start.setUTCHours(0, 0, 0, 0);
        startDate = start.toISOString();
    } else if (when === 'last_week') {
        const thisWeek = new Date();
        thisWeek.setUTCDate(thisWeek.getUTCDate() - thisWeek.getUTCDay());
        thisWeek.setUTCHours(0, 0, 0, 0);
        const lastWeek = new Date(thisWeek);
        lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
        startDate = lastWeek.toISOString();
        endDate = thisWeek.toISOString();
    }

    const cleanUids = (uids && uids.length > 0) ? uids.filter(id => id && id.toString().trim() !== "") : null;

    const { data, error } = await supabase
        .rpc('get_ranked_leaderboard', {
            p_tid: parseInt(tid),
            p_order_metric: orderMetric,
            p_start_date: startDate,
            p_end_date: endDate,
            p_uids: cleanUids,
            p_limit: limit
        });

    if (error) {
        console.error('[DB] Error fetching leaderboard RPC:', error);
        throw error;
    }

    return data;
}

async function addCoins(ngId, amount) {
    if (amount === 0) return;
    const { error } = await supabase
        .rpc('add_coins', {
            user_id: String(ngId),
            coin_delta: parseInt(amount)
        });

    if (error) {
        console.error('[DB] Error adding coins:', error);
        throw error;
    }
}

async function getChallenges(uid) {
    const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .or(`uid1.eq.${uid},uid2.eq.${uid}`)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[DB] Error fetching challenges:', error);
        throw error;
    }
    return data;
}

async function createChallenge(data) {
    const { data: newChallenge, error } = await supabase
        .from('challenges')
        .insert([data])
        .select()
        .single();

    if (error) {
        console.error('[DB] Error creating challenge:', error);
        throw error;
    }
    return newChallenge;
}

async function updateChallenge(id, updates) {
    const { data: updated, error } = await supabase
        .from('challenges')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('[DB] Error updating challenge:', error);
        throw error;
    }
    return updated;
}

async function deleteChallenge(id) {
    const { error } = await supabase
        .from('challenges')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('[DB] Error deleting challenge:', error);
        throw error;
    }
}

module.exports = {
    supabase,
    getProfile,
    getProfiles,
    updateProfile,
    addCoins,
    recordScore,
    getLeaderboard,
    getChallenges,
    createChallenge,
    updateChallenge,
    deleteChallenge,
    DEFAULT_SAVE
};
