import { createClient } from '@supabase/supabase-js';
let _supabase = null;
function getSupabase(env) {
  if (!_supabase) {
    _supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return _supabase;
}
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
async function fetchBingJson(url) {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    },
  });
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`Bing 接口请求失败：HTTP ${response.status}，响应：${rawText.slice(0, 200)}`);
  }
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`Bing 接口返回了非 JSON 内容（HTTP ${response.status}）：${rawText.slice(0, 200) || '(空响应)'}`);
  }
}
async function fetchBingImages(mkt = 'zh-CN', idxList = [0, 7]) {
  const domain = mkt === 'zh-CN' ? 'cn.bing.com' : 'www.bing.com';
  const url1 = `https://www.bing.com/HPImageArchive.aspx?format=js&idx=${idxList[0]}&n=8&mkt=${mkt}`;
  const url2 = `https://www.bing.com/HPImageArchive.aspx?format=js&idx=${idxList[1]}&n=8&mkt=${mkt}`;
  const [data1, data2] = await Promise.all([fetchBingJson(url1), fetchBingJson(url2)]);
  const mergedImages = [...(data1.images || []), ...(data2.images || [])];
  const images = Array.from(
    new Map(mergedImages.map(img => [`${img.urlbase}${img.enddate}`, img])).values()
  ).map(img => ({
    ...img,
    uhdurl: `https://${domain}${img.urlbase}_UHD.jpg`,
    whurl: `https://${domain}${img.urlbase}_UHD.jpg&w=3840&h=2160&rs=1&c=1`,
  })).sort((a, b) => b.enddate.localeCompare(a.enddate));
  return { images, sourceUrls: [url1, url2] };
}
async function updateWallpapers(env, addCorsHeaders = null) {
  try {
    const supabase = getSupabase(env);
    const { images: uniqueImages } = await fetchBingImages('zh-CN', [0, 7]);
    const results = { inserted: 0, skipped: 0, errors: [] };
    if (uniqueImages.length === 0) {
      return addCorsHeaders ? addCorsHeaders(Response.json(results)) : results;
    }
    const wallpapersToUpsert = uniqueImages.map(img => ({
      enddate: img.enddate,
      url: img.uhdurl,
      copyright: img.copyright,
      title: img.title,
      views: 0
    }));
    const { data: insertedData, error: upsertError } = await supabase
      .from(env.SUPABASE_TABLE_NAME)
      .upsert(wallpapersToUpsert, { onConflict: 'enddate', ignoreDuplicates: true })
      .select('enddate');
    if (upsertError) {
      results.errors.push({ error: upsertError.message });
    } else {
      results.inserted = insertedData ? insertedData.length : 0;
      results.skipped = uniqueImages.length - results.inserted;
    }
    return addCorsHeaders ? addCorsHeaders(Response.json(results)) : results;
  } catch (error) {
    const errorResult = { error: error.message };
    return addCorsHeaders ? addCorsHeaders(Response.json(errorResult, { status: 500 })) : errorResult;
  }
}
async function fetchWallpaperResult(env, { mode = 'search', keyword = '', pageNumber = 1, pageSize = 30 } = {}) {
  const supabase = getSupabase(env);
  if (mode === 'views') {
    const { data, error } = await supabase
      .rpc('increment_wallpaper_views', { p_enddate: keyword });
    if (error) {
      throw new ApiError(400, error.message);
    }
    if (!Array.isArray(data) || data.length === 0) {
      throw new ApiError(404, 'No data found for the given enddate');
    }
    return { output: data };
  }
  const rangeStart = (pageNumber - 1) * pageSize;
  let query = supabase
    .from(env.SUPABASE_TABLE_NAME)
    .select('*');
  if (mode === 'enddate') {
    query = query.eq('enddate', keyword);
  } else {
    const searchKeyword = `%${keyword}%`;
    query = query.or(`title.ilike.${searchKeyword},copyright.ilike.${searchKeyword},enddate.ilike.${searchKeyword}`);
  }
  const { data, error } = await query
    .order('enddate', { ascending: false })
    .range(rangeStart, rangeStart + pageSize);
  if (error) {
    throw new ApiError(400, error.message);
  }
  return {
    Previous_Page: Math.max(pageNumber - 1, 1),
    Page: pageNumber,
    Next_Page: data.length <= pageSize ? pageNumber : pageNumber + 1,
    output: data.slice(0, pageSize),
  };
}
async function fetchWallpaperByEnddate(env, enddate) {
  if (enddate) {
    return fetchWallpaperResult(env, { mode: 'enddate', keyword: String(enddate), pageNumber: 1, pageSize: 1 });
  }
  return fetchWallpaperResult(env, { mode: 'search', keyword: '', pageNumber: 1, pageSize: 1 });
}
async function WallpaperData(env, keyword = '', pageNumber = 1, pageSize = 30, mode = 'search') {
  try {
    const result = await fetchWallpaperResult(env, { mode, keyword, pageNumber, pageSize });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: error.status || 500 });
  }
}
export default {
  async scheduled(controller, env, ctx) {
    console.log('定时任务开始');
    const result = await updateWallpapers(env);
    console.log('定时任务完成:', result);
  },
  handleError(error, context = '', corsHeaders = null) {
    console.error(`[${context}] Error:`, error);
    console.error(`[${context}] Error stack:`, error.stack);
    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error.message,
      context: context
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...(corsHeaders || {}),
      }
    });
  },
  applyLongTermCache(headers) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.delete('ETag');
    headers.delete('Last-Modified');
    return headers;
  },
  applyNoCache(headers) {
    headers.set('Cache-Control', 'private, no-store, max-age=0');
    headers.delete('ETag');
    headers.delete('Last-Modified');
    return headers;
  },
  applyDailyCache(headers) {
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.delete('ETag');
    headers.delete('Last-Modified');
    return headers;
  },
  methodNotAllowed(allow, corsHeaders = null) {
    const headers = new Headers({
      'Allow': allow,
      'Content-Type': 'application/json;charset=UTF-8',
    });
    if (corsHeaders) {
      Object.entries(corsHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });
    }
    this.applyNoCache(headers);
    return new Response(JSON.stringify({ error: 'Method Not Allowed', allow }, null, 2), {
      status: 405,
      headers,
    });
  },
  async serveTransformedAsset(env, request, assetPath, { contentType, cache = 'long', transform }) {
    const assetResponse = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url)));
    const content = await assetResponse.text();
    const headers = new Headers(assetResponse.headers);
    headers.set('Content-Type', contentType);
    if (cache === 'none') {
      this.applyNoCache(headers);
    } else if (cache === 'daily') {
      this.applyDailyCache(headers);
    } else {
      this.applyLongTermCache(headers);
    }
    return new Response(transform(content), { headers });
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;
    const isApiRoute = pathname.startsWith('/api/') || pathname.startsWith('/wallpaper/');
    const isGetOnlyRoute = pathname === '/'
      || pathname === '/detail'
      || pathname === '/detail/'
      || pathname.startsWith('/assets/entries/');
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') {
      const requestHeaders = request.headers.get('Access-Control-Request-Headers');
      const headers = { ...corsHeaders };
      if (requestHeaders) {
        headers['Access-Control-Allow-Headers'] = requestHeaders;
      }
      return new Response(null, {
        status: 204,
        headers,
      });
    }
    if (isApiRoute && request.method !== 'GET' && request.method !== 'POST') {
      return this.methodNotAllowed('GET, POST, OPTIONS', corsHeaders);
    }
    if (isGetOnlyRoute && request.method !== 'GET') {
      return this.methodNotAllowed('GET', corsHeaders);
    }
    const addCorsHeaders = (response) => {
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      newHeaders.set('Cache-Control', 'private, no-store, max-age=0');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    };
    const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
      status,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    });
    let parsedBody;
    const param = async (name) => {
      if (request.method !== 'POST') {
        return searchParams.get(name);
      }
      if (parsedBody === undefined) {
        parsedBody = await request.json().catch(() => ({}));
      }
      return parsedBody[name];
    };
    const isReadMethod = request.method === 'GET' || request.method === 'POST';
    if (isReadMethod && (pathname === '/wallpaper/search' || pathname === '/api/search')) {
      const keyword = (await param('search')) || '';
      const pageNumber = Math.max(Number(await param('page')) || 1, 1);
      const pageSize = Math.min(Math.max(Number(await param('limit')) || 30, 1), 100);
      const response = await WallpaperData(env, keyword, pageNumber, pageSize, 'search');
      return addCorsHeaders(response);
    }
    if (isReadMethod && (pathname === '/wallpaper/detail' || pathname === '/api/detail')) {
      const keyword = (await param('enddate')) || '';
      const response = await WallpaperData(env, keyword, 1, 1, 'enddate');
      return addCorsHeaders(response);
    }
    if (isReadMethod && (pathname === '/wallpaper/view' || pathname === '/api/view')) {
      const keyword = (await param('enddate')) || '';
      const response = await WallpaperData(env, keyword, 1, 1, 'views');
      return addCorsHeaders(response);
    }
    if (isReadMethod && (pathname === '/wallpaper/update' || pathname === '/api/update')) {
      return await updateWallpapers(env, addCorsHeaders);
    }
    if (isReadMethod && (pathname === '/wallpaper/bing-hp' || pathname === '/api/bing-hp')) {
      const mkt = (await param('mkt')) || 'zh-CN';
      try {
        const { images, sourceUrls } = await fetchBingImages(mkt);
        return addCorsHeaders(jsonResponse({
          images,
          totalImages: images.length,
          mkt: mkt,
          sourceUrls: sourceUrls,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error({ message: 'Error processing request', error: error.message });
        return addCorsHeaders(jsonResponse({
          error: error.message,
          timestamp: Date.now()
        }, 500));
      }
    }
    const index = env.INDEX_JS;
    const detail = env.DETAIL_JS;
    const routing = env.ROUTING_JS;
    if (pathname === '/') {
      try {
        const queryString = new URLSearchParams(url.search).toString();
        return await this.serveTransformedAsset(env, request, '/', {
          contentType: 'text/html; charset=utf-8',
          cache: 'long',
          transform: (html) => html
            .replace(index, `${index}?${queryString}`)
            .replace(routing, `${routing}?${queryString}" crossorigin="anonymous" `),
        });
      } catch (error) {
        return this.handleError(error, 'Root path processing', corsHeaders);
      }
    }
    if (pathname === '/detail' || pathname === '/detail/') {
      try {
        const hasEnddate = url.searchParams.has('enddate');
        const result = await fetchWallpaperByEnddate(env, url.searchParams.get('enddate'));
        const item = result.output[0];
        if (!item) {
          return addCorsHeaders(jsonResponse({ error: 'Wallpaper not found' }, 404));
        }
        const detailQuery = new URLSearchParams(url.search);
        if (!detailQuery.has('enddate')) {
          detailQuery.set('enddate', item.enddate);
        }
        const queryString = detailQuery.toString();
        const replacements = {
          [detail]: `${detail}?${queryString}`,
          [routing]: `${routing}?${queryString}" crossorigin="anonymous" `,
          '示例标题': item.title,
          'https://cn.bing.com/th?id=OHR.NewYearFox_ZH-CN9312618796_UHD.jpg': item.url,
          '示例查看次数': item.views,
          '示例版权文本': item.copyright,
          '示例日期': item.enddate
        };
        return await this.serveTransformedAsset(env, request, '/detail/', {
          contentType: 'text/html; charset=utf-8',
          cache: hasEnddate ? 'long' : 'daily',
          transform: (html) => {
            for (const [search, replace] of Object.entries(replacements)) {
              html = html.replace(new RegExp(escapeRegExp(search), 'g'), replace);
            }
            return html;
          },
        });
      } catch (error) {
        return this.handleError(error, 'Detail path processing', corsHeaders);
      }
    }
    if (pathname === '/assets/entries/' + routing) {
      try {
        const queryString = new URLSearchParams(url.search).toString();
        return await this.serveTransformedAsset(env, request, '/assets/entries/' + routing, {
          contentType: 'application/javascript; charset=utf-8',
          cache: 'long',
          transform: (js) => js
            .replace(new RegExp(index, 'g'), `${index}?${queryString}`)
            .replace(new RegExp(detail, 'g'), `${detail}?${queryString}`),
        });
      } catch (error) {
        return this.handleError(error, 'Routing JS processing', corsHeaders);
      }
    }
    if (pathname === '/assets/entries/' + index || pathname === '/assets/entries/' + detail) {
      try {
        const isIndex = pathname === '/assets/entries/' + index;
        const parseParam = (value, defaultVal) => {
          const parsed = parseInt(value, 10);
          return isNaN(parsed) ? defaultVal : parsed;
        };
        let entryData;
        let extraReplace = null;
        if (isIndex) {
          const search = url.searchParams.get('search') || '';
          const limitParam = Math.max(1, Math.min(100, parseParam(url.searchParams.get('limit'), 30)));
          const pageParam = Math.max(1, parseParam(url.searchParams.get('page'), 1));
          const sizeParam = Math.max(0, Math.min(6, parseParam(url.searchParams.get('size'), 1)));
          entryData = await fetchWallpaperResult(env, {
            mode: 'search',
            keyword: String(search),
            pageNumber: pageParam,
            pageSize: limitParam,
          });
          extraReplace = (js) => js.replace(
            /search:"",limit:100,size:1/g,
            `search:"${search}",limit:${limitParam},size:${sizeParam}`
          );
        } else {
          entryData = await fetchWallpaperByEnddate(env, url.searchParams.get('enddate'));
        }
        const entryName = isIndex ? index : detail;
        const entryDataRegex = /\{Next_Page:\s*\d+,\s*Page:\s*\d+,\s*Previous_Page:\s*\d+,\s*output:\s*\[.*?\]\s*\}/s;
        const jsonReplacement = JSON.stringify(entryData);
        return await this.serveTransformedAsset(env, request, '/assets/entries/' + entryName, {
          contentType: 'application/javascript; charset=utf-8',
          cache: 'none',
          transform: (js) => {
            js = js.replace(entryDataRegex, () => jsonReplacement);
            return extraReplace ? extraReplace(js) : js;
          },
        });
      } catch (error) {
        console.error('Entry JS processing error:', error);
        return addCorsHeaders(jsonResponse({ error: 'Internal server error' }, 500));
      }
    }
    const assetResponse = await env.ASSETS.fetch(request);
    const assetHeaders = new Headers(assetResponse.headers);
    this.applyLongTermCache(assetHeaders);
    if (isApiRoute) {
      Object.entries(corsHeaders).forEach(([key, value]) => assetHeaders.set(key, value));
      this.applyNoCache(assetHeaders);
    }
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers: assetHeaders,
    });
  }
}