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

function formatDateISO(isoString) {
    if (!isoString) return "0000-00-00";
    const d = new Date(isoString);
    const year = d.getFullYear();
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- 1. RECHERCHE (Avec Numérotation 01, 02...) ---
async function searchResults(keyword) {
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

        if (!user) return JSON.stringify([]);

        let edges = user.videos?.edges || [];
        
        // 1. TRI CHRONOLOGIQUE (Plus récent en premier)
        edges.sort((a, b) => {
            return new Date(b.node.publishedAt).getTime() - new Date(a.node.publishedAt).getTime();
        });

        // 2. CONSTRUCTION AVEC NUMÉROTATION
        const results = edges.map((edge, index) => {
            const video = edge.node;
            const dateStr = formatDateISO(video.publishedAt);
            
            // On crée un numéro "01", "02", "03"... basé sur la position dans la liste triée
            // (index + 1) car l'index commence à 0
            const number = (index + 1).toString().padStart(2, '0');

            let rawTitle = safeText(video.title);
            if (!rawTitle) rawTitle = "VOD Sans Titre";

            // Titre formaté : "01. [Date] Titre"
            // L'app va trier par "01", puis "02", etc.
            const displayTitle = `${number}. [${dateStr}] ${rawTitle}`;

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
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    try {
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
                    const rawDesc = safeText(video.description);
                    
                    const fullDesc = `📅 ${d} | ⏱ ${mins} min | 👁 ${video.viewCount} vues\n\n${rawDesc}`;

                    return JSON.stringify([{
                        description: fullDesc,
                        author: author,
                        date: d,
                        aliases: `${mins} min`
                    }]);
                }
            }
        }
        return JSON.stringify([{ description: 'Info indisponible', author: 'Twitch', date: '' }]);
    } catch (error) {
        return JSON.stringify([{ description: 'Erreur chargement', author: 'Twitch', date: '' }]);
    }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(url) {
    try {
        return JSON.stringify([{
            href: url,
            number: 1,
            title: "Lancer la Vidéo",
            season: 1
        }]);
    } catch (error) { return JSON.stringify([]); }
}

// --- 4. STREAM ---
async function extractStreamUrl(url) {
    try {
        let streams = [];
        let videoId = "";

        if (url.includes("/videos/")) {
            const match = url.match(/\/videos\/(\d+)/);
            if (match) videoId = match[1];
        }

        if (videoId) {
            // 1. NoSub (Priorité)
            try {
                const storyboardQuery = { query: `query { video(id: "${videoId}") { seekPreviewsURL } }` };
                const sbResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(storyboardQuery) });
                const sbJson = await sbResp.json();
                const seekPreviewsURL = sbJson.data?.video?.seekPreviewsURL;
                if (seekPreviewsURL) {
                    const urlParts = seekPreviewsURL.split('/storyboards/');
                    if (urlParts.length > 0) {
                        streams.push({
                            title: "VOD (NoSub - Sans Pub)",
                            streamUrl: `${urlParts[0]}/chunked/index-dvr.m3u8`,
                            headers: { "Referer": "https://www.twitch.tv/" }
                        });
                    }
                }
            } catch (e) {}

            // 2. Officiel (Backup)
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
                        title: "VOD (Officiel)",
                        streamUrl: `https://usher.ttvnw.net/vod/${videoId}.m3u8?nauth=${safeToken}&nauthsig=${safeSig}&allow_source=true&player_backend=mediaplayer`,
                        headers: { "Referer": "https://www.twitch.tv/" }
                    });
                }
            } catch (e) {}
        }

        return JSON.stringify({ streams: streams, subtitles: [] });

    } catch (error) { return JSON.stringify({ streams: [], subtitles: [] }); }
}

// --- UTILITAIRE SORA ---
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(
                url,
                options.headers ?? {},
                options.method ?? 'GET',
                options.body ?? null,
                true,
                options.encoding ?? 'utf-8'
            );
        } else {
            return await fetch(url, options);
        }
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}
