/**
 * mal.js — MyAnimeList search scraper
 * Usage:
 *   node mal.js 86
 *   node mal.js 41457
 *   node mal.js "naruto"
 *   node mal.js manga "one piece"
 *   Credits : VORTEX
 */
const https = require("https");
const http = require("http");
const zlib = require("zlib");
const { URL } = require("url");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function request(urlStr, { headers = {}, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === "https:" ? https : http;

    const h = {
      "User-Agent": UA,
      Accept: "application/json, text/html, */*",
      "Accept-Encoding": "gzip, deflate",
      Referer: "https://myanimelist.net/",
      ...headers,
    };

    // Node rejects undefined header values — strip them
    Object.keys(h).forEach((k) => {
      if (h[k] === undefined || h[k] === null) delete h[k];
    });

    const req = mod.request(
      u,
      { method: "GET", timeout, headers: h },
      (res) => {
        const chunks = [];
        let stream = res;
        const enc = (res.headers["content-encoding"] || "").toLowerCase();
        if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
        else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
        stream.on("data", (c) => chunks.push(c));
        stream.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
        stream.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("Request timeout")));
    req.on("error", reject);
    req.end();
  });
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

async function malSearch(query, type = "anime", limit = 10) {
  const q = String(query || "").trim();
  if (!q) throw new Error("Empty query");

  const t = type === "manga" ? "manga" : "anime";
  const url =
    "https://myanimelist.net/search/prefix.json?type=" +
    encodeURIComponent(t) +
    "&keyword=" +
    encodeURIComponent(q) +
    "&v=1";

  const r = await request(url, {
    headers: {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (r.status !== 200) throw new Error("MAL search HTTP " + r.status);

  let data;
  try {
    data = JSON.parse(r.body);
  } catch (_) {
    throw new Error("MAL search invalid JSON");
  }

  const cat =
    (data.categories || []).find((c) => c.type === t) ||
    (data.categories && data.categories[0]);
  const items = (cat && cat.items) || [];

  return items.slice(0, limit).map((it) => ({
    id: it.id,
    title: it.name,
    type: (it.payload && it.payload.media_type) || t,
    year: (it.payload && it.payload.start_year) || null,
    aired: (it.payload && it.payload.aired) || null,
    score: (it.payload && it.payload.score) || null,
    status: (it.payload && it.payload.status) || null,
    url: it.url,
    image: it.image_url || it.thumbnail_url || null,
  }));
}

async function malInfo(id, type = "anime") {
  const num = String(id).replace(/\D/g, "");
  if (!num) throw new Error("Invalid MAL id");

  const t = type === "manga" ? "manga" : "anime";
  const pageUrl = "https://myanimelist.net/" + t + "/" + num;

  const r = await request(pageUrl, {
    headers: { Accept: "text/html" },
  });
  if (r.status !== 200) throw new Error("MAL page HTTP " + r.status);

  const html = r.body;
  const og = (prop) => {
    const m = html.match(
      new RegExp('property="og:' + prop + '"\\s+content="([^"]*)"', "i")
    );
    return m ? decodeHtml(m[1]) : null;
  };

  const scoreM = html.match(/itemprop="ratingValue"[^>]*>([0-9.]+)/i);
  const scoreCountM = html.match(/itemprop="ratingCount"[^>]*>([0-9]+)/i);
  const engM = html.match(/class="title-english[^"]*">([^<]+)/i);
  const genres = [...html.matchAll(/itemprop="genre"[^>]*>([^<]+)/gi)].map(
    (m) => decodeHtml(m[1])
  );

  const meta = (label) => {
    const re = new RegExp(
      label + ":</span>\\s*(?:<[^>]+>\\s*)*([^<]+)",
      "i"
    );
    const m = html.match(re);
    return m ? decodeHtml(m[1]) : null;
  };

  return {
    id: Number(num),
    title: og("title") || null,
    title_english: engM ? decodeHtml(engM[1]) : null,
    type: t,
    url: og("url") || pageUrl,
    image: og("image") || null,
    synopsis: og("description") || null,
    score: scoreM ? scoreM[1] : null,
    scored_by: scoreCountM ? Number(scoreCountM[1]) : null,
    genres,
    episodes: meta("Episodes"),
    status: meta("Status"),
    aired: meta("Aired") || meta("Published"),
    duration: meta("Duration"),
    rating: meta("Rating"),
    studios: meta("Studios"),
    source: meta("Source"),
  };
}

async function myas(query, type = "anime") {
  const q = String(query || "").trim();
  if (!q) throw new Error("Empty query");

  if (/^\d+$/.test(q)) {
    return { mode: "info", result: await malInfo(q, type) };
  }
  return { mode: "search", result: await malSearch(q, type, 10) };
}

module.exports = { malSearch, malInfo, myas };

if (require.main === module) {
  const args = process.argv.slice(2);
  let type = "anime";
  let query = args[0];

  if (args[0] === "manga" || args[0] === "anime") {
    type = args[0];
    query = args[1];
  }

  if (!query) {
    console.log('Usage: node mal.js "86"');
    console.log("       node mal.js 41457");
    console.log('       node mal.js manga "one piece"');
    process.exit(1);
  }

  myas(query, type)
    .then((out) => console.log(JSON.stringify(out, null, 2)))
    .catch((e) => {
      console.error("Error:", e.message);
      process.exit(1);
    });
}
