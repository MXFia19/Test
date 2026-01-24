const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const HEADERS = {
    'Client-ID': CLIENT_ID,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv',
    'Content-Type': 'application/json'
};

// --- OUTILS ---
function safeText(str) {
    if (!str) return "";
    return str.replace(/"/g, "'").replace(/[\r\n]+/g, " ").trim();
}

function formatDate(isoString) {
    if (!isoString) return "Inconnu";
    const d = new Date(isoString);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

// --- 1. RECHERCHE (Affiche les 20 dernières VODs) ---
async function searchResults(keyword) {
    try {
        const cleanKeyword = keyword.trim().toLowerCase();
        
        const query = {
            query: `query {
                user(login: "${cleanKeyword}") {
                    login
                    videos(first: 20) {
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
        const edges = user?.videos?.edges || [];

        const results = edges.map(edge => {
            const video = edge.node;
            const dateStr = formatDate(video.publishedAt);
            
            let title = safeText(video.title);
            if (!title) title = `VOD du ${dateStr}`;

            let img = video.previewThumbnailURL;
            if (img && !img.includes("404_preview")) {
                img = img.replace("{width}", "1280").replace("{height}", "720");
            } else {
                img = "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
            }

            return {
                title: title,
                image: img,
                // On passe l'ID complet pour que extractDetails sache quoi afficher
                href: `${user.login}|${video.id}` 
            };
        });

        return JSON.stringify(results);
    } catch (error) { return JSON.stringify([]); }
}

// --- 2. DÉTAILS (VERSION MOVIE : Info de la VOD précise) ---
async function extractDetails(idStr) {
    try {
        const parts = idStr.split('|');
        const login = parts[0];
        const videoId = parts[1]; // L'ID de la vidéo cliquée

        // Si c'est un LIVE
        if (videoId.startsWith("LIVE_")) {
             return JSON.stringify([{
                description: "Diffusion en direct sur Twitch",
                author: login,
                date: "Aujourd'hui"
            }]);
        }

        // Si c'est une VOD, on demande les infos précises de CETTE vidéo
        const query = {
            query: `query {
                video(id: "${videoId}") {
                    title
                    description
                    publishedAt
                    viewCount
                    lengthSeconds
                }
            }`
        };

        const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
        const json = await responseText.json();
        const video = json.data?.video;

        let desc = safeText(video?.description || "Aucune description");
        const dateStr = formatDate(video?.publishedAt);
        const duration = Math.floor((video?.lengthSeconds || 0) / 60) + " min";
        const views = video?.viewCount || 0;

        // On construit une belle description pour la page du film
        const fullDesc = `📅 Date: ${dateStr}\n⏱ Durée: ${duration}\n👁 Vues: ${views}\n\n${desc}`;

        return JSON.stringify([{
            description: fullDesc,
            author: login,
            date: dateStr
        }]);

    } catch (error) { 
        return JSON.stringify([{ description: 'Info indisponible', author: 'Twitch', date: '' }]); 
    }
}

// --- 3. ÉPISODES (VERSION MOVIE : Lien direct vers la vidéo) ---
// En mode Movie, cette fonction sert juste à dire "Voici le lien à lire"
async function extractEpisodes(idStr) {
    try {
        const parts = idStr.split('|');
        const login = parts[0];
        const videoId = parts[1];

        const episodes = [];
        
        // On renvoie un seul "épisode" qui correspond au Film/VOD choisi
        episodes.push({
            href: videoId.startsWith("LIVE_") ? "LIVE_" + login : videoId,
            number: 1,
            season: 1,
            title: "Regarder",
            description: "Lancer la vidéo",
            duration: "",
            image: "" 
        });

        return JSON.stringify(episodes);
    } catch (error) { return JSON.stringify([]); }
}

// --- 4. STREAM ---
async function extractStreamUrl(vodId) {
    try {
        let streams = [];
        const isLive = vodId.toString().startsWith("LIVE_");
        let login = "";
        let realVodId = vodId;

        if (isLive) login = vodId.replace("LIVE_", "");
        else realVodId = vodId;

        if (isLive) {
            try {
                const tokenQuery = {
                    operationName: "PlaybackAccessToken_Template",
                    query: "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) { value signature __typename } }",
                    variables: { isLive: true, login: login, isVod: false, vodID: "", playerType: "site" }
                };
                const tokenResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(tokenQuery) });
                const tokenJson = await tokenResp.json();
                const tokenData = tokenJson.data?.streamPlaybackAccessToken;
                if (tokenData) {
                    const safeToken = encodeURIComponent(tokenData.value);
                    const safeSig = encodeURIComponent(tokenData.signature);
                    streams.push({
                        title: "Live (Officiel)",
                        streamUrl: `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?token=${safeToken}&sig=${safeSig}&allow_source=true&player_backend=mediaplayer`,
                        headers: { "Referer": "https://www.twitch.tv/" }
                    });
                }
            } catch (e) {}
        } else {
            try {
                const storyboardQuery = { query: `query { video(id: "${realVodId}") { seekPreviewsURL } }` };
                const sbResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(storyboardQuery) });
                const sbJson = await sbResp.json();
                const seekPreviewsURL = sbJson.data?.video?.seekPreviewsURL;
                if (seekPreviewsURL) {
                    const urlParts = seekPreviewsURL.split('/storyboards/');
                    if (urlParts.length > 0) {
                        streams.push({
                            title: "Lecture VOD (NoSub)",
                            streamUrl: `${urlParts[0]}/chunked/index-dvr.m3u8`,
                            headers: { "Referer": "https://www.twitch.tv/" }
                        });
                    }
                }
            } catch (e) {}
        }
        return JSON.stringify({ streams: streams, subtitles: [] });
    } catch (error) { return JSON.stringify({ streams: [], subtitles: [] }); }
}

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        if (typeof fetchv2 !== 'undefined') return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null, true, options.encoding ?? 'utf-8');
        else return await fetch(url, options);
    } catch (e) { try { return await fetch(url, options); } catch (error) { return null; } }
}
