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

// --- 1. RECHERCHE (Correction du bug "previewImage") ---
async function searchResults(keyword) {
    console.log(`[TwitchDebug] Recherche lancée pour : ${keyword}`);
    try {
        const cleanKeyword = keyword.trim().toLowerCase();
        
        // REQUÊTE PRINCIPALE CORRIGÉE
        // On remplace 'previewImage { url }' par 'previewImageURL(width: 1280, height: 720)'
        let queryTemplate = `query {
            user(login: "KEYWORD_PLACEHOLDER") {
                login
                displayName
                stream {
                    id
                    title
                    game { name }
                    previewImageURL(width: 1280, height: 720) 
                }
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
        }`;

        let query = { query: queryTemplate.replace("KEYWORD_PLACEHOLDER", cleanKeyword) };

        let responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
        let json = await responseText.json();
        
        if (json.errors) {
            console.log(`[TwitchDebug] GQL Errors (Direct): ${JSON.stringify(json.errors)}`);
        }

        let user = json.data?.user;

        // REQUÊTE SECOURS : Si l'utilisateur n'est pas trouvé directement, on cherche la chaîne
        if (!user) {
            console.log(`[TwitchDebug] User direct non trouvé, tentative de recherche floue...`);
            const searchQuery = {
                query: `query {
                    searchFor(text: "${cleanKeyword}") {
                        channels {
                            edges {
                                node { login }
                            }
                        }
                    }
                }`
            };
            const searchResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(searchQuery) });
            const searchJson = await searchResp.json();
            const foundChannel = searchJson.data?.searchFor?.channels?.edges?.[0]?.node;

            if (foundChannel && foundChannel.login) {
                console.log(`[TwitchDebug] Chaîne trouvée via recherche : ${foundChannel.login}`);
                // On relance la requête principale avec le bon login
                query.query = queryTemplate.replace("KEYWORD_PLACEHOLDER", foundChannel.login);
                responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
                json = await responseText.json();
                user = json.data?.user;
            }
        }

        if (!user) {
             console.log(`[TwitchDebug] Echec total : Utilisateur introuvable.`);
             return JSON.stringify([]);
        }

        const results = [];

        // A. LIVE (Affiché comme un film en tête)
        if (user.stream) {
            const stream = user.stream;
            // previewImageURL renvoie directement une string maintenant
            let img = stream.previewImageURL || "https://pngimg.com/uploads/twitch/twitch_PNG13.png";

            const safeTitle = safeText(stream.title) || "Direct";
            
            results.push({
                title: `🔴 LIVE: ${safeTitle}`,
                image: img,
                href: `https://twitch.tv/live/${user.login}`
            });
        }

        // B. VODS
        const edges = user.videos?.edges || [];
        console.log(`[TwitchDebug] VODs trouvées : ${edges.length}`);
        
        edges.forEach(edge => {
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

            results.push({
                title: title,
                image: img,
                href: `https://twitch.tv/videos/${video.id}`
            });
        });

        return JSON.stringify(results);

    } catch (error) {
        console.log(`[TwitchDebug] CRITICAL ERROR: ${error}`);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    try {
        let desc = "";
        let dateInfo = "";
        let durationInfo = "";
        let author = "Twitch";

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
                    author = video.owner?.displayName || "Streamer";
                    const d = formatDate(video.publishedAt);
                    const mins = Math.floor((video.lengthSeconds || 0) / 60);
                    
                    dateInfo = d;
                    durationInfo = `${mins} min`;
                    let rawDesc = safeText(video.description);
                    
                    desc = `📅 ${d} | ⏱ ${mins} min | 👁 ${video.viewCount} vues\n\n${rawDesc}`;
                }
            }
        } else {
            desc = "Diffusion en direct. Cliquez pour rejoindre le stream.";
            dateInfo = "En Direct";
            durationInfo = "LIVE";
        }

        return JSON.stringify([{
            description: desc || "Pas de description",
            author: author,
            date: dateInfo,
            aliases: durationInfo // Ajouté pour afficher la durée
        }]);

    } catch (error) {
        return JSON.stringify([{ description: 'Info indisponible', author: 'Twitch', date: '' }]);
    }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(url) {
    try {
        const isVod = url.includes("/videos/");
        const title = isVod ? "Lancer la Vidéo" : "Regarder le Direct";

        return JSON.stringify([{
            href: url,
            number: 1,
            title: title,
            season: 1
        }]);
    } catch (error) { return JSON.stringify([]); }
}

// --- 4. STREAM ---
async function extractStreamUrl(url) {
    try {
        let streams = [];
        let videoId = "";
        let login = "";
        let isLive = false;

        if (url.includes("/videos/")) {
            const match = url.match(/\/videos\/(\d+)/);
            if (match) videoId = match[1];
        } else if (url.includes("/live/")) {
            const parts = url.split('/');
            login = parts[parts.length - 1];
            isLive = true;
        }

        // CAS A : LIVE
        if (isLive && login) {
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
                        title: "Live (Source)",
                        streamUrl: `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?token=${safeToken}&sig=${safeSig}&allow_source=true&player_backend=mediaplayer`,
                        headers: { "Referer": "https://www.twitch.tv/" }
                    });
                }
            } catch(e) {}
        } 
        
        // CAS B : VOD
        else if (videoId) {
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
