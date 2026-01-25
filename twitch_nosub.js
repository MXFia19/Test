const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

// --- CONFIGURATION DASHBOARD (DISCORD) ---
const WEBHOOK_URL = "https://discord.com/api/webhooks/1083089368782221342/qJL5w1AVNtlsanrmE4IOTQXGD9z7DbuvTfZ4wLnYcI4oWkQ0Xpaj8-m7zBOev_MOz0Bh"; 
const MESSAGE_ID = "1464832159104635173"; 

// --- CONFIGURATION COMPTEUR (COUNTERAPI V2) ---
const COUNTER_WORKSPACE = "mxfia19s-team-2616";
const COUNTER_KEY = "ut_ZuEPzqNnk7zMH0ooTeZIzBcnRpLnqWvf26fXcc2D";

const HEADERS = {
    'Client-ID': CLIENT_ID,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv',
    'Content-Type': 'application/json'
};

// --- TOOLS ---
function safeText(str) {
    if (!str) return "";
    return str.replace(/"/g, "'").replace(/[\r\n]+/g, " ").trim();
}

function formatDateISO(isoString) {
    if (!isoString) return "0000-00-00";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "0000-00-00";
    const year = d.getFullYear();
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- 1. SEARCH ---
async function searchResults(keyword) {
    console.log(`[Twitch] Searching for: ${keyword}`);

    // ACTION: Compteur V2 + Discord
    handleGlobalCounter("searches", keyword, 3447003); // Bleu

    try {
        const cleanKeyword = keyword.trim().toLowerCase();
        
        const query = {
            query: `query {
                user(login: "${cleanKeyword}") {
                    login
                    displayName
                    videos(first: 20, type: ARCHIVE, sort: TIME) {
                        edges {
                            node {
                                id
                                title
                                publishedAt
                                previewThumbnailURL(height: 360, width: 640)
                            }
                        }
                    }
                }
            }`
        };

        const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
        const json = await responseText.json();
        const user = json.data?.user;

        if (!user) {
            return JSON.stringify([{
                title: "Streamer not found. Please check spelling.",
                image: "https://pngimg.com/uploads/twitch/twitch_PNG13.png",
                href: "ERROR_NOT_FOUND"
            }]);
        }

        let edges = user.videos?.edges || [];

        if (edges.length === 0) {
            return JSON.stringify([{
                title: `No videos found for ${user.displayName}.`,
                image: "https://pngimg.com/uploads/twitch/twitch_PNG13.png",
                href: "ERROR_NO_VODS"
            }]);
        }

        // Safety Sort (Tri Chronologique - Plus récent en premier)
        edges.sort((a, b) => new Date(b.node.publishedAt).getTime() - new Date(a.node.publishedAt).getTime());

        const results = edges.map(edge => {
            const video = edge.node;
            const dateStr = formatDateISO(video.publishedAt);
            let rawTitle = safeText(video.title) || "Untitled VOD";
            const displayTitle = `[${dateStr}] ${rawTitle}`;

            let img = video.previewThumbnailURL;
            if (img && !img.includes("404_preview")) {
                img = img.replace("{width}", "1280").replace("{height}", "720");
            } else {
                img = "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
            }

            return {
                title: displayTitle,
                image: img,
                href: `https://www.twitch.tv/videos/${video.id}`
            };
        });

        return JSON.stringify(results);

    } catch (error) {
        return JSON.stringify([{
            title: "Technical error. Check logs.",
            image: "https://pngimg.com/uploads/twitch/twitch_PNG13.png",
            href: "ERROR_CRASH"
        }]);
    }
}

// --- 2. DETAILS ---
async function extractDetails(url) {
    try {
        if (url === "ERROR_NOT_FOUND") return JSON.stringify([{ description: "Streamer does not exist.", author: "System", date: "Error" }]);
        if (url === "ERROR_NO_VODS") return JSON.stringify([{ description: "No VODs available.", author: "System", date: "Info" }]);

        if (url.includes("/videos/")) {
            const match = url.match(/\/videos\/(\d+)/);
            const videoId = match ? match[1] : "";

            if (videoId) {
                const query = {
                    query: `query {
                        video(id: "${videoId}") {
                            title
                            description
                            publishedAt
                            viewCount
                            lengthSeconds
                            owner { displayName }
                        }
                    }`
                };
                const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
                const json = await responseText.json();
                const video = json.data?.video;

                if (video) {
                    const author = video.owner?.displayName || "Streamer";
                    const d = formatDateISO(video.publishedAt);
                    const mins = Math.floor((video.lengthSeconds || 0) / 60);
                    const fullDesc = `📅 ${d} | ⏱ ${mins} min | 👁 ${video.viewCount} views\n\n${safeText(video.description)}`;
                    return JSON.stringify([{ description: fullDesc, author: author, date: d, aliases: `${mins} min` }]);
                }
            }
        }
        return JSON.stringify([{ description: 'Info unavailable', author: 'Twitch', date: '' }]);
    } catch (error) { return JSON.stringify([{ description: 'Loading error', author: 'Twitch', date: '' }]); }
}

// --- 3. EPISODES ---
async function extractEpisodes(url) {
    try {
        if (url.startsWith("ERROR_")) return JSON.stringify([]);
        return JSON.stringify([{ href: url, number: 1, title: "Play Video", season: 1 }]);
    } catch (error) { return JSON.stringify([]); }
}

// --- 4. STREAM ---
async function extractStreamUrl(url) {
    // ACTION: Compteur V2 + Discord
    if (!url.startsWith("ERROR_")) {
        let videoIdLog = "Unknown";
        if (url.includes("/videos/")) {
             const m = url.match(/\/videos\/(\d+)/);
             if(m) videoIdLog = m[1];
        }
        handleGlobalCounter("streams", `VOD ID: ${videoIdLog}`, 5763719); // Vert
    }

    try {
        let streams = [];
        if (url.startsWith("ERROR_")) return JSON.stringify({ streams: [], subtitles: [] });

        let videoId = "";
        if (url.includes("/videos/")) {
            const match = url.match(/\/videos\/(\d+)/);
            if (match) videoId = match[1];
        }

        if (videoId) {
            // NoSub
            try {
                const storyboardQuery = { query: `query { video(id: "${videoId}") { seekPreviewsURL } }` };
                const sbResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(storyboardQuery) });
                const sbJson = await sbResp.json();
                const seekPreviewsURL = sbJson.data?.video?.seekPreviewsURL;
                if (seekPreviewsURL) {
                    const urlParts = seekPreviewsURL.split('/storyboards/');
                    if (urlParts.length > 0) {
                        streams.push({
                            title: "VOD (NoSub - No Ads)",
                            streamUrl: `${urlParts[0]}/chunked/index-dvr.m3u8`,
                            headers: { "Referer": "https://www.twitch.tv/" }
                        });
                    }
                }
            } catch (e) {}

            // Official
            try {
                const tokenQuery = {
                    operationName: "PlaybackAccessToken_Template",
                    query: "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { videoPlaybackAccessToken(id: $vodID, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }",
                    variables: { isLive: false, login: "", isVod: true, vodID: videoId, playerType: "site" }
                };
                const tokenResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(tokenQuery) });
                const tokenJson = await tokenResp.json();
                const tokenData = tokenJson.data?.videoPlaybackAccessToken;
                if (tokenData) {
                    const safeToken = encodeURIComponent(tokenData.value);
                    const safeSig = encodeURIComponent(tokenData.signature);
                    streams.push({
                        title: "VOD (Official)",
                        streamUrl: `https://usher.ttvnw.net/vod/${videoId}.m3u8?nauth=${safeToken}&nauthsig=${safeSig}&allow_source=true&player_backend=mediaplayer`,
                        headers: { "Referer": "https://www.twitch.tv/" }
                    });
                }
            } catch (e) {}
        }
        return JSON.stringify({ streams: streams, subtitles: [] });
    } catch (error) { return JSON.stringify({ streams: [], subtitles: [] }); }
}

// --- GESTION COMPTEUR GLOBAL (V2 - Authentifiée) ---
async function handleGlobalCounter(type, details, color) {
    if (!WEBHOOK_URL || !MESSAGE_ID) return;
    if (!COUNTER_WORKSPACE || !COUNTER_KEY) {
        console.log("Missing CounterAPI V2 credentials");
        return;
    }

    try {
        // 1. Incrémenter la valeur (UP)
        // Note: l'URL V2 nécessite le Workspace
        const countUrl = `https://api.counterapi.dev/v2/${COUNTER_WORKSPACE}/${type}/up`;
        
        const countResp = await soraFetch(countUrl, {
            method: 'GET', // V2 utilise GET pour up, mais demande le header Authorization
            headers: {
                "Authorization": `Bearer ${COUNTER_KEY}`
            }
        });
        const countJson = await countResp.json();
        const currentCount = countJson.count;

        // 2. Lire l'autre valeur (sans l'incrémenter) pour l'affichage
        const otherType = (type === "searches") ? "streams" : "searches";
        const otherUrl = `https://api.counterapi.dev/v2/${COUNTER_WORKSPACE}/${otherType}`;
        
        const otherResp = await soraFetch(otherUrl, {
            method: 'GET',
            headers: {
                "Authorization": `Bearer ${COUNTER_KEY}`
            }
        });
        const otherJson = await otherResp.json();
        const otherCount = otherJson.count || 0;

        const totalSearches = (type === "searches") ? currentCount : otherCount;
        const totalStreams = (type === "streams") ? currentCount : otherCount;

        // 3. Mise à jour Discord
        updateDiscordDashboard(type === "searches" ? "🔍 Search" : "▶️ Stream", details, color, totalSearches, totalStreams);

    } catch (e) {
        console.log("Counter V2 Error: " + e);
        // Si ça plante, on essaie quand même d'afficher le log Discord sans les totaux
        updateDiscordDashboard(type === "searches" ? "🔍 Search" : "▶️ Stream", details, color, "?", "?");
    }
}

async function updateDiscordDashboard(action, details, color, totalSearches, totalStreams) {
    try {
        const editUrl = `${WEBHOOK_URL}/messages/${MESSAGE_ID}`;

        const payload = {
            embeds: [{
                title: "🌍 Global Module Stats",
                description: "Real-time statistics from all users.",
                color: color,
                fields: [
                    {
                        name: "📊 Global Totals",
                        value: `Searches: **${totalSearches}**\nStreams: **${totalStreams}**`,
                        inline: false
                    },
                    {
                        name: "⚡ Latest Action",
                        value: `**${action}**: \`${details}\``,
                        inline: false
                    }
                ],
                footer: {
                    text: `Updated at ${new Date().toLocaleTimeString()}`
                }
            }]
        };

        soraFetch(editUrl, {
            method: 'PATCH',
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.log("Dashboard update error: " + e);
    }
}

// --- UTILS SORA ---
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        if (typeof fetchv2 !== 'undefined') return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null, true, options.encoding ?? 'utf-8');
        else return await fetch(url, options);
    } catch(e) { try { return await fetch(url, options); } catch(error) { return null; } }
}
