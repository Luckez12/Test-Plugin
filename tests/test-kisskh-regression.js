const assert = require('assert');
const path = require('path');

const providerPath = path.join(__dirname, '..', 'providers', 'kisskh.js');

function response(data, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data)
  });
}

function loadProvider() {
  delete require.cache[require.resolve(providerPath)];
  return require(providerPath);
}

async function testStaleContextFallsBackToRequestedTmdb() {
  global.VUEO_DISCOVERY_CONTEXT = {
    tmdbId: 111,
    mediaType: 'movie',
    title: 'Wrong Movie',
    year: '2020',
    tmdb: { id: 111, title: 'Wrong Movie', release_date: '2020-01-01' }
  };
  delete global.vueoDiscoveryContext;

  let tmdbCalls = 0;
  global.fetch = (url) => {
    url = String(url);
    if (url.includes('api.themoviedb.org/3/movie/222')) {
      tmdbCalls += 1;
      return response({
        id: 222,
        title: 'Right Movie',
        original_title: 'Right Movie',
        release_date: '2024-06-01',
        alternative_titles: { titles: [] },
        translations: { translations: [] }
      });
    }
    if (url.includes('/api/DramaList/Search')) {
      return response([{ id: 22, title: 'Right Movie', year: 2024, type: 'movie' }]);
    }
    if (url.includes('/api/DramaList/Drama/22')) {
      return response({
        id: 22,
        title: 'Right Movie',
        releaseDate: '2024-06-01',
        type: 'movie',
        episodes: [{ id: 220, number: 1 }]
      });
    }
    if (url.includes('script.google.com/macros/')) {
      return response({ key: 'test-key' });
    }
    if (url.includes('/api/DramaList/Episode/220.png')) {
      return response({ Video: 'https://cdn.example/right-movie-1080.m3u8' });
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const streams = await loadProvider().getStreams('222', 'movie');
  assert.strictEqual(tmdbCalls, 1, 'stale context must fall back to requested TMDB metadata');
  assert.strictEqual(streams.length, 1, 'expected one valid stream');
  assert.strictEqual(streams[0].title, 'Right Movie');
  assert.strictEqual(streams[0].url, 'https://cdn.example/right-movie-1080.m3u8');
}

async function testPartialTitleDoesNotSelectSequel() {
  delete global.VUEO_DISCOVERY_CONTEXT;
  delete global.vueoDiscoveryContext;

  global.fetch = (url) => {
    url = String(url);
    if (url.includes('api.themoviedb.org/3/movie/333')) {
      return response({
        id: 333,
        title: 'Right Movie',
        original_title: 'Right Movie',
        release_date: '2024-06-01',
        alternative_titles: { titles: [] },
        translations: { translations: [] }
      });
    }
    if (url.includes('/api/DramaList/Search')) {
      return response([{ id: 33, title: 'Right Movie 2', year: 2024, type: 'movie' }]);
    }
    if (url.includes('/api/DramaList/Drama/33')) {
      return response({
        id: 33,
        title: 'Right Movie 2',
        releaseDate: '2024-06-01',
        type: 'movie',
        episodes: [{ id: 330, number: 1 }]
      });
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const streams = await loadProvider().getStreams('333', 'movie');
  assert.deepStrictEqual(streams, [], 'a sequel/longer partial title must not be accepted');
}


async function testGentlemenDoesNotMatchPrincess() {
  global.VUEO_DISCOVERY_CONTEXT = {
    tmdbId: '236235',
    mediaType: 'tv',
    title: 'The Gentlemen',
    year: '2024',
    tmdb: { id: 236235, name: 'The Gentlemen', first_air_date: '2024-03-07' }
  };
  delete global.vueoDiscoveryContext;

  let videoKeyCalls = 0;
  let sourceCalls = 0;
  global.fetch = (url) => {
    url = String(url);
    if (url.includes('api.themoviedb.org')) {
      throw new Error('TMDB should not be called for matching direct context');
    }
    if (url.includes('/api/DramaList/Search')) {
      return response([{ id: 9557, title: 'The Princess (2024)', year: 2024, type: 'drama' }]);
    }
    if (url.includes('/api/DramaList/Drama/9557')) {
      return response({
        id: 9557,
        title: 'The Princess (2024)',
        releaseDate: '2024-01-01',
        type: 'drama',
        episodes: [{ id: 955701, number: 1 }]
      });
    }
    if (url.includes('script.google.com/macros/')) {
      videoKeyCalls += 1;
      return response({ key: 'should-not-be-used' });
    }
    if (url.includes('/api/DramaList/Episode/')) {
      sourceCalls += 1;
      return response({ Video: 'https://cdn.example/wrong.m3u8' });
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const streams = await loadProvider().getStreams('236235', 'tv', 1, 1);
  assert.deepStrictEqual(streams, [], 'The Princess must never match The Gentlemen');
  assert.strictEqual(videoKeyCalls, 0, 'wrong-title candidate must stop before video-key lookup');
  assert.strictEqual(sourceCalls, 0, 'wrong-title candidate must stop before source lookup');
}

async function testMatchingContextCanBeUsed() {
  global.VUEO_DISCOVERY_CONTEXT = {
    tmdbId: '444',
    mediaType: 'movie',
    title: "Hero's Return",
    year: '2025',
    tmdb: { id: 444, title: "Hero's Return", release_date: '2025-02-01' }
  };
  delete global.vueoDiscoveryContext;

  let tmdbCalls = 0;
  global.fetch = (url) => {
    url = String(url);
    if (url.includes('api.themoviedb.org')) {
      tmdbCalls += 1;
      throw new Error('TMDB should not be called for matching direct context');
    }
    if (url.includes('/api/DramaList/Search')) {
      return response([{ id: 44, title: 'Heros Return', year: 2025, type: 'movie' }]);
    }
    if (url.includes('/api/DramaList/Drama/44')) {
      return response({
        id: 44,
        title: 'Heros Return',
        releaseDate: '2025-02-01',
        type: 'movie',
        episodes: [{ id: 440, number: 1 }]
      });
    }
    if (url.includes('script.google.com/macros/')) return response({ key: 'test-key' });
    if (url.includes('/api/DramaList/Episode/440.png')) {
      return response({ Video: 'https://cdn.example/heros-return.m3u8' });
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const streams = await loadProvider().getStreams('444', 'movie');
  assert.strictEqual(tmdbCalls, 0);
  assert.strictEqual(streams.length, 1);
}

(async () => {
  await testStaleContextFallsBackToRequestedTmdb();
  await testPartialTitleDoesNotSelectSequel();
  await testGentlemenDoesNotMatchPrincess();
  await testMatchingContextCanBeUsed();
  console.log('KissKH regression tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
